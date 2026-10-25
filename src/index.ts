import { createPublicClient, http, defineChain, formatUnits, parseAbi, type Address } from "viem";

const stockTokenAbi = parseAbi(["function uiMultiplier() external view returns (uint256)"]);

// Robinhood Chain Mainnet (EIP-155: 4663)
const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.blockvectra.com/v1/robinhood_mainnet"] } },
});

interface StockDaily {
  day: string;
  token: Address;
  symbol: string;
  name: string;
  transfers: number;
  unique_senders: number;
  unique_receivers: number;
  mint_raw_amount: string;
  burn_raw_amount: string;
  net_supply_change: string;
  holder_count: number;
  top10_holder_share_bps: number;
  dex_swap_count: number;
  dex_raw_volume: string;
  refreshed_at: string;
}

interface StockDailyListEnvelope {
  data: StockDaily[];
  meta: Record<string, unknown>;
}

interface StockTokenEnvelope {
  data: {
    address: Address;
    symbol: string;
    name: string;
    decimals: number | null;
    daily: Array<{
      day: string;
      transfers: number;
      unique_senders: number;
      unique_receivers: number;
      holder_count: number;
      top10_holder_share_bps: number;
      dex_swap_count: number;
    }>;
  };
  meta: Record<string, unknown>;
}

class CliError extends Error {}

function parseArgs(args: string[]) {
  const options: { token?: string; day?: string; limit?: number; withMultiplier?: boolean; help?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--token" && args[i + 1]) options.token = args[++i];
    else if (arg === "--day" && args[i + 1]) options.day = args[++i];
    else if (arg === "--limit" && args[i + 1]) options.limit = parseInt(args[++i], 10);
    else if (arg === "--with-multiplier") options.withMultiplier = true;
  }
  return options;
}

function createRpcClient(apiKey: string, rpcUrl: string) {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(rpcUrl, {
      retryCount: 0,
      timeout: 10_000,
      fetchOptions: apiKey ? { headers: { "x-api-key": apiKey } } : undefined,
    }),
  });
}

type RpcClient = ReturnType<typeof createRpcClient>;

async function fetchApi<T>(url: string, apiKey: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new CliError("Data API request failed or timed out (10s limit).");
  }
  if (!res.ok) {
    const errorBody = await res.text();
    let msg = `Data API HTTP ${res.status} ${res.statusText}`;
    try {
      const json = JSON.parse(errorBody);
      if (json.error?.message) msg += `: ${json.error.message}`;
    } catch {}
    throw new CliError(msg);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new CliError("Data API returned invalid JSON.");
  }
}

async function ensureRobinhoodChain(client: RpcClient): Promise<void> {
  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch {
    throw new CliError("Unable to verify RPC chain ID; multiplier query aborted.");
  }
  if (chainId !== robinhoodChain.id) {
    throw new CliError(`RPC chain ID ${chainId} does not match Robinhood Chain (4663); multiplier query aborted.`);
  }
}

async function readMultiplier(client: RpcClient, address: Address): Promise<string> {
  try {
    const raw = await client.readContract({ address, abi: stockTokenAbi, functionName: "uiMultiplier" });
    return `${Number(formatUnits(raw, 18)).toFixed(4)}x`;
  } catch {
    return "unavailable";
  }
}

function metaValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "unknown";
  return String(value);
}

function printDataMetadata(meta: Record<string, unknown> | undefined): void {
  const refreshedAt = meta?.refreshed_at;
  console.log(`Data refreshed at: ${metaValue(refreshedAt)}`);
  console.log(`Data as of block: ${metaValue(meta?.as_of_block)}`);
  if (metaValue(refreshedAt) === "unknown") {
    console.log("Freshness: unknown (treat as stale)");
  }
}

function requestedDayLabel(day: string | undefined): string {
  return day ? `${day} (UTC)` : "latest recorded";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Robinhood Chain Stock Token Activity Dashboard (CLI)
Usage: pnpm start [--token <0x...>] [--day <YYYY-MM-DD>] [--limit <number>] [--with-multiplier]
Options:
  --token <address>   Query metrics for a specific stock token
  --day <YYYY-MM-DD>  Query daily leaderboard for a specific UTC date
  --limit <number>    Number of tokens to display (default: 10, max: 500)
  --with-multiplier   Verify RPC chain ID 4663, then read uiMultiplier() (opt-in; default off)
  --help, -h          Show this help message
Request budget: 1 Data GET by default; --with-multiplier adds 1 eth_chainId and up to 10 eth_call (max 12 requests).
Data requests use a single 10s timeout, and multiplier calls are never retried.`);
    return;
  }

  const apiKey = process.env.BLOCKVECTRA_API_KEY || "";
  const rpcUrl = process.env.BLOCKVECTRA_RPC_URL || "https://api.blockvectra.com/v1/robinhood_mainnet";
  const dataApiBase = process.env.BLOCKVECTRA_DATA_API_URL || "https://api.blockvectra.com/v1/data";

  console.log("BlockVectra - Robinhood Chain Stock Token Dashboard");
  console.log("---------------------------------------------------");

  try {
    if (opts.token) {
      const tokenAddress = opts.token as Address;
      const res = await fetchApi<StockTokenEnvelope>(`${dataApiBase}/robinhood_mainnet/stocks/${tokenAddress}`, apiKey);
      const meta = res.meta ?? undefined;
      console.log(`Token: ${res.data.name} (${res.data.symbol}) | Address: ${res.data.address}`);
      printDataMetadata(meta);
      if (opts.withMultiplier) {
        const client = createRpcClient(apiKey, rpcUrl);
        await ensureRobinhoodChain(client);
        const mult = await readMultiplier(client, tokenAddress);
        console.log(`Corporate Action Multiplier: ${mult}\n`);
      } else {
        console.log();
      }
      console.log("Recent Daily Activity (up to 10 days):");
      console.table(
        res.data.daily.slice(0, 10).map((d) => ({
          Day: d.day,
          Holders: d.holder_count,
          Transfers: d.transfers,
          Senders: d.unique_senders,
          Receivers: d.unique_receivers,
          "Top 10 Share": `${(d.top10_holder_share_bps / 100).toFixed(2)}%`,
          "DEX Swaps": d.dex_swap_count,
        }))
      );
    } else {
      const limit = opts.limit || 10;
      const dayParam = opts.day ? `&day=${opts.day}` : "";
      const url = `${dataApiBase}/robinhood_mainnet/stocks?limit=${limit}${dayParam}`;
      const res = await fetchApi<StockDailyListEnvelope>(url, apiKey);
      const meta = res.meta ?? undefined;

      console.log(`Requested day: ${requestedDayLabel(opts.day)}`);
      printDataMetadata(meta);

      if (!res.data || res.data.length === 0) {
        console.log("No stock tokens recorded for the requested date.");
        return;
      }

      let multipliers: string[] = [];
      if (opts.withMultiplier) {
        const client = createRpcClient(apiKey, rpcUrl);
        await ensureRobinhoodChain(client);
        const multiplierCount = Math.min(res.data.length, 10);
        for (let i = 0; i < multiplierCount; i++) {
          multipliers.push(await readMultiplier(client, res.data[i].token));
        }
      }

      const rows = res.data.map((item, index) => ({
        Day: item.day,
        Symbol: item.symbol,
        Name: item.name,
        Address: item.token,
        ...(opts.withMultiplier
          ? { Multiplier: index < multipliers.length ? multipliers[index] : "not queried (limit 10)" }
          : {}),
        Holders: item.holder_count,
        Transfers: item.transfers,
        Senders: item.unique_senders,
        Receivers: item.unique_receivers,
        "Top 10": `${(item.top10_holder_share_bps / 100).toFixed(2)}%`,
        "DEX Swaps": item.dex_swap_count,
      }));
      console.table(rows);
    }
    console.log("\nNote: On-chain activity data, not stock prices, does not constitute investment advice.");
  } catch (err: unknown) {
    const message = err instanceof CliError ? err.message : "unexpected error";
    console.error(`\nError: ${message}`);
    if (message.includes("401") || message.includes("missing_api_key")) {
      console.error("\nA BlockVectra API key is required. Set BLOCKVECTRA_API_KEY in your environment.");
      console.error("- Get API Key: https://blockvectra.com/en/get-api-key/?ref=gh-robinhood-stock-tokens");
      console.error("- Programmatic Sign-up: https://docs.blockvectra.com/en/guides/programmatic-signup/?ref=gh-robinhood-stock-tokens");
    }
    process.exit(1);
  }
}

main();

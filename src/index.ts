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

function parseArgs(args: string[]) {
  const options: { token?: string; day?: string; limit?: number; help?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--token" && args[i + 1]) options.token = args[++i];
    else if (arg === "--day" && args[i + 1]) options.day = args[++i];
    else if (arg === "--limit" && args[i + 1]) options.limit = parseInt(args[++i], 10);
  }
  return options;
}

async function fetchApi<T>(url: string, apiKey: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errorBody = await res.text();
    let msg = `HTTP ${res.status} ${res.statusText}`;
    try {
      const json = JSON.parse(errorBody);
      if (json.error?.message) msg += `: ${json.error.message}`;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

async function getMultiplier(client: ReturnType<typeof createPublicClient>, address: Address): Promise<string> {
  try {
    const raw = await client.readContract({ address, abi: stockTokenAbi, functionName: "uiMultiplier" });
    return `${Number(formatUnits(raw, 18)).toFixed(4)}x`;
  } catch {
    return "N/A";
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Robinhood Chain Stock Token Activity Dashboard (CLI)
Usage: pnpm start [--token <0x...>] [--day <YYYY-MM-DD>] [--limit <number>]
Options:
  --token <address>   Query metrics and multiplier for a specific stock token
  --day <YYYY-MM-DD>  Query daily leaderboard for a specific UTC date
  --limit <number>    Number of tokens to display (default: 10, max: 500)
  --help, -h          Show this help message`);
    return;
  }

  const apiKey = process.env.BLOCKVECTRA_API_KEY || "";
  const rpcUrl = process.env.BLOCKVECTRA_RPC_URL || "https://api.blockvectra.com/v1/robinhood_mainnet";
  const dataApiBase = process.env.BLOCKVECTRA_DATA_API_URL || "https://api.blockvectra.com/v1/data";

  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(rpcUrl, { fetchOptions: apiKey ? { headers: { "x-api-key": apiKey } } : undefined }),
  });

  console.log("BlockVectra - Robinhood Chain Stock Token Dashboard");
  console.log("---------------------------------------------------");

  try {
    if (opts.token) {
      const tokenAddress = opts.token as Address;
      const res = await fetchApi<StockTokenEnvelope>(`${dataApiBase}/robinhood_mainnet/stocks/${tokenAddress}`, apiKey);
      const mult = await getMultiplier(client, tokenAddress);
      console.log(`Token: ${res.data.name} (${res.data.symbol}) | Address: ${res.data.address}`);
      console.log(`Corporate Action Multiplier: ${mult}\n`);
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

      if (!res.data || res.data.length === 0) {
        console.log("No stock tokens recorded for the requested date.");
        return;
      }

      const rows = await Promise.all(
        res.data.map(async (item) => {
          const mult = await getMultiplier(client, item.token);
          return {
            Symbol: item.symbol,
            Name: item.name,
            Address: item.token,
            Multiplier: mult,
            Holders: item.holder_count,
            Transfers: item.transfers,
            Senders: item.unique_senders,
            Receivers: item.unique_receivers,
            "Top 10": `${(item.top10_holder_share_bps / 100).toFixed(2)}%`,
            "DEX Swaps": item.dex_swap_count,
          };
        })
      );
      console.table(rows);
    }
    console.log("\nNote: On-chain activity data, not stock prices, does not constitute investment advice.");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
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

# Robinhood Chain Stock Token Activity Dashboard (CLI)

A command-line dashboard demonstrating how to query on-chain activity and contract state for tokenized stocks on Robinhood Chain using the BlockVectra Data API and JSON-RPC.

This example reports on-chain activity and the ERC-8056 corporate action multiplier. It is not a daily stock price service and does not provide market quotes.

> **Disclaimer**: On-chain activity data, not stock prices, does not constitute investment advice.

---

## Overview

Robinhood Chain supports tokenized real-world assets (RWAs), including tokenized equities and exchange-traded funds (ETFs) issued by Robinhood Assets (Jersey) Limited (RHJ). These tokens implement **ERC-8056 (Scaled UI Amount Extension)** to support corporate actions (such as stock splits) via an on-chain multiplier without altering user token balances.

This application combines two BlockVectra interfaces with one API key:
1. **BlockVectra Data API**: Retrieves indexed daily aggregated metrics (holders, transfers, active senders/receivers, DEX trading volume) via `GET /v1/data/robinhood_mainnet/stocks`.
2. **BlockVectra JSON-RPC**: Executes `eth_call` on the token contract to read the `uiMultiplier()` function directly from the chain. This path is opt-in through `--with-multiplier`; the Data API-only default does not create an RPC client.

---

## Network & Protocol Specifications

- **Network Identifier**: `robinhood_mainnet`
- **EIP-155 Chain ID**: `4663`
- **JSON-RPC Endpoint**: `https://api.blockvectra.com/v1/robinhood_mainnet`
- **Data API Base**: `https://api.blockvectra.com/v1/data`
- **Stock Token Multiplier**:
  - Function: `uiMultiplier()` (`0xa60bf13d`)
  - Specification: ERC-8056 Scaled UI Amount Extension (18 decimals fixed point, `1e18 = 1.0`)
  - Calculation: `underlying shares = raw token amount × uiMultiplier ÷ 1e18`
- **Data API Endpoints** (from `data.yaml`):
  - Daily Leaderboard: `GET /v1/data/robinhood_mainnet/stocks` (parameters: `day`, `limit`)
  - Single Token Metrics: `GET /v1/data/robinhood_mainnet/stocks/{token}`
- **Pricing & CU Weights**:
  - Calls to each endpoint consume Compute Units (CU) based on actual method weights. For current rates, billing details, and free tier limits, refer to the [BlockVectra Pricing Page](https://blockvectra.com/en/pricing/?ref=gh-robinhood-stock-tokens).

---

## Authentication & API Keys

A BlockVectra API key is required to query the endpoints.

- **Web Console**: Obtain a key via [BlockVectra Get API Key](https://blockvectra.com/en/get-api-key/?ref=gh-robinhood-stock-tokens).
- **Programmatic Sign-up**: Automated workflows, CI pipelines, and AI agents can create accounts and provision API keys using wallet signatures (EIP-191) without a browser via the [Programmatic Sign-up Guide](https://docs.blockvectra.com/en/guides/programmatic-signup/?ref=gh-robinhood-stock-tokens).

Set the key as an environment variable:

```bash
export BLOCKVECTRA_API_KEY="your_api_key_here"
```

### Unauthenticated Behavior

When called without an API key:
- **Data API** returns HTTP `401 Unauthorized` with `{"error":{"code":"missing_api_key","message":"missing API key: send it in the x-api-key header"}}`. The CLI detects this response and points to `BLOCKVECTRA_API_KEY`.
- **JSON-RPC** authentication depends on the configured endpoint's chain and method policy. Some endpoints allow public reads, while others require an identity or API key for specific methods. The opt-in multiplier path reuses the same `BLOCKVECTRA_API_KEY` and sends it as `x-api-key`, so no separate RPC credential is required by this example.

---

## Requirements

- **Node.js 24 or newer**. The `start` script uses Node's built-in `--env-file-if-exists` flag.

---

## Installation & Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env and fill in BLOCKVECTRA_API_KEY
   ```

   `npm start` loads `.env` automatically when the file exists. Exported environment variables take precedence over values in `.env`, so an existing `BLOCKVECTRA_API_KEY` export overrides the file. You can also skip `.env` entirely and export `BLOCKVECTRA_API_KEY` (plus any optional endpoint overrides) directly; `npm start` runs without a `.env` file.

---

## Usage

### 1. View Daily Stock Token Activity Leaderboard

Query the daily leaderboard ordered by transfer activity descending:

```bash
npm start
```

This default makes one Data API request and no JSON-RPC request. Each row shows the UTC day actually recorded for that row, and the header shows the requested day (or `latest recorded`) plus the response metadata.

### 2. Query Specific Date and Limit

```bash
# Query a specific UTC date with custom limit
npm start -- --day 2026-09-30 --limit 5
```

### 3. Query a Specific Token

Query contract details and recent daily metrics for a specific token address:

```bash
npm start -- --token 0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D
```

### 4. Read the Corporate Action Multiplier (Opt-In)

`uiMultiplier()` is only queried when `--with-multiplier` is passed. The CLI first verifies the RPC endpoint reports chain ID `4663`, then reads the multiplier for the token, or for at most the first 10 leaderboard rows, one call at a time:

```bash
npm start -- --with-multiplier
npm start -- --token 0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D --with-multiplier
```

A chain ID mismatch or unverifiable chain ID exits non-zero before any `eth_call`. A failed per-token read is shown as `unavailable`; rows beyond the 10-call cap are shown as `not queried (limit 10)`. The CLI does not fill in a zero or guessed multiplier.

### 5. CLI Options

| Option | Description | Default |
|---|---|---|
| `--token <address>` | Query single stock token details and recent daily metrics | None |
| `--day <YYYY-MM-DD>` | Query daily leaderboard for a specific UTC date | Latest recorded day |
| `--limit <number>` | Number of tokens to display (1–500) | `10` |
| `--with-multiplier` | Verify chain ID `4663` and read `uiMultiplier()` via JSON-RPC | Off |
| `--help`, `-h` | Display help information | |

---

## Request Budget, Freshness, and Output

- **Default budget**: exactly one Data API `GET` and zero JSON-RPC requests. The RPC client is not created unless `--with-multiplier` is set.
- **Opt-in budget**: at most one Data API `GET`, one `eth_chainId` verification, and 10 sequential `eth_call` requests, for a maximum of 12 requests. Multiplier calls are not parallel and are not retried.
- **Timeouts**: every Data API request uses `AbortSignal.timeout(10_000)`. The JSON-RPC transport uses `timeout: 10_000` and `retryCount: 0`.
- **Dates**: the leaderboard header prints the requested UTC `--day` or `latest recorded`; each leaderboard row prints its own recorded `Day`. Token mode keeps the `Day` column in its recent daily activity table.
- **Metadata**: both modes print the response's original `meta.refreshed_at` and `meta.as_of_block`, or `unknown` when the field is missing or null. A missing/null `refreshed_at` also prints `Freshness: unknown (treat as stale)`. An `as_of_block` value alone does not make the data current-day or a live quote.
- **Empty results**: metadata is printed before the original `No stock tokens recorded for the requested date.` message, and the command exits `0` without any RPC request.
- **No stale-duration threshold**: the CLI reports the source metadata and leaves freshness assessment to the caller. It does not invent a time window or alter the multiplier calculation and precision.

---

## References

- [BlockVectra Robinhood Chain Guide](https://docs.blockvectra.com/en/guides/robinhood-chain/?ref=gh-robinhood-stock-tokens)
- [BlockVectra Tokenized Stocks Guide](https://docs.blockvectra.com/en/guides/stocks/?ref=gh-robinhood-stock-tokens)
- [BlockVectra Stock Token Multiplier Guide](https://docs.blockvectra.com/en/guides/stock-token-multiplier/?ref=gh-robinhood-stock-tokens)
- [Robinhood Chain Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [BlockVectra Pricing](https://blockvectra.com/en/pricing/?ref=gh-robinhood-stock-tokens)

---

## License

[MIT](LICENSE)

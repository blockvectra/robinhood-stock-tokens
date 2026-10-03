# Robinhood Chain Stock Token Activity Dashboard (CLI)

A command-line dashboard demonstrating how to query on-chain activity and contract state for tokenized stocks on Robinhood Chain using the BlockVectra Data API and JSON-RPC.

> **Disclaimer**: On-chain activity data, not stock prices, does not constitute investment advice.

---

## Overview

Robinhood Chain supports tokenized real-world assets (RWAs), including tokenized equities and exchange-traded funds (ETFs) issued by Robinhood Assets (Jersey) Limited (RHJ). These tokens implement **ERC-8056 (Scaled UI Amount Extension)** to support corporate actions (such as stock splits) via an on-chain multiplier without altering user token balances.

This application combines two BlockVectra interfaces with one API key:
1. **BlockVectra Data API**: Retrieves indexed daily aggregated metrics (holders, transfers, active senders/receivers, DEX trading volume) via `GET /v1/data/robinhood_mainnet/stocks`.
2. **BlockVectra JSON-RPC**: Executes `eth_call` on the token contract to read the `uiMultiplier()` function directly from the chain.

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
  - Calls to each endpoint consume Compute Units (CU) based on actual method weights. For current rates, billing details, and free tier limits, refer to the [BlockVectra Pricing Page](https://blockvectra.com/en/pricing/).

---

## Authentication & API Keys

A BlockVectra API key is required to query the endpoints.

- **Web Console**: Obtain a key via [BlockVectra Get API Key](https://blockvectra.com/en/get-api-key/).
- **Programmatic Sign-up**: Automated workflows, CI pipelines, and AI agents can create accounts and provision API keys using wallet signatures (EIP-191) without a browser via the [Programmatic Sign-up Guide](https://docs.blockvectra.com/en/guides/programmatic-signup/).

Set the key as an environment variable:

```bash
export BLOCKVECTRA_API_KEY="your_api_key_here"
```

### Unauthenticated Behavior

When called without an API key:
- **Data API** returns HTTP `401 Unauthorized` with `{"error":{"code":"missing_api_key","message":"missing API key: send it in the x-api-key header"}}`.
- **JSON-RPC** returns HTTP `401 Unauthorized` with JSON-RPC error code `-32024` (`missing_api_key`).

The CLI detects unauthenticated responses and informs you how to set the environment variable.

---

## Installation & Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment** (optional):
   ```bash
   cp .env.example .env
   # Edit .env and fill in BLOCKVECTRA_API_KEY
   ```

---

## Usage

### 1. View Daily Stock Token Activity Leaderboard

Query the daily leaderboard ordered by transfer activity descending:

```bash
npm start
```

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

### 4. CLI Options

| Option | Description | Default |
|---|---|---|
| `--token <address>` | Query single stock token details and recent daily metrics | None |
| `--day <YYYY-MM-DD>` | Query daily leaderboard for a specific UTC date | Latest recorded day |
| `--limit <number>` | Number of tokens to display (1–500) | `10` |
| `--help`, `-h` | Display help information | |

---

## References

- [BlockVectra Robinhood Chain Guide](https://docs.blockvectra.com/en/guides/robinhood-chain/)
- [BlockVectra Tokenized Stocks Guide](https://docs.blockvectra.com/en/guides/stocks/)
- [BlockVectra Stock Token Multiplier Guide](https://docs.blockvectra.com/en/guides/stock-token-multiplier/)
- [Robinhood Chain Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [BlockVectra Pricing](https://blockvectra.com/en/pricing/)

---

## License

[MIT](LICENSE)

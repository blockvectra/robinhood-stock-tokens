# Robinhood Chain 股票代币链上活动看板（命令行版）

本示例展示如何通过 BlockVectra Data API 与 JSON-RPC，在命令行中查询 Robinhood Chain 上股票代币的链上活动数据及合约状态。

本示例展示的是链上活动与 ERC-8056 公司行动乘数，不是每日股票价格服务，也不提供行情报价。

> **免责声明**：链上活动数据，不是股价，不构成投资建议。

---

## 概述

Robinhood Chain 支持代币化真实世界资产（RWA），包括由 Robinhood Assets (Jersey) Limited (RHJ) 发行的代币化股票与 ETF。此类代币遵循 **ERC-8056（Scaled UI Amount Extension）** 规范，通过合约内乘数支持拆股等公司行动，而无需变动持有者钱包余额。

本项目使用同一个 API key 组合调用 BlockVectra 的两个接口服务：
1. **BlockVectra Data API**：通过 `GET /v1/data/robinhood_mainnet/stocks` 获取代币化股票的每日聚合链上指标（持有人数、转账数、活跃收发地址、DEX 成交量等）。
2. **BlockVectra JSON-RPC**：通过 `eth_call` 直接读取代币合约的 `uiMultiplier()` 方法获取链上最新乘数。该路径仅在显式传入 `--with-multiplier` 时启用；默认只查 Data API，不创建 RPC client。

---

## 网络与协议规格

- **网络标识**：`robinhood_mainnet`
- **EIP-155 Chain ID**：`4663`
- **JSON-RPC 端点**：`https://api.blockvectra.com/v1/robinhood_mainnet`
- **Data API 基础路径**：`https://api.blockvectra.com/v1/data`
- **股票代币乘数**：
  - 合约方法：`uiMultiplier()`（选择器 `0xa60bf13d`）
  - 规格：ERC-8056 Scaled UI Amount 扩展（18 位定点数精度，`1e18 = 1.0`）
  - 换算公式：`底层股数 = 原始代币数量 × uiMultiplier ÷ 1e18`
- **Data API 接口**（定义见 `data.yaml`）：
  - 每日活跃榜单：`GET /v1/data/robinhood_mainnet/stocks`（查询参数：`day`、`limit`）
  - 单代币历史指标：`GET /v1/data/robinhood_mainnet/stocks/{token}`
- **计量与 CU 权重**：
  - 各调用端点根据所执行的方法按实际权重计量消耗 CU，具体计费明细、费率与免费额度请参阅 [BlockVectra 定价页](https://blockvectra.com/zh/pricing/?ref=gh-robinhood-stock-tokens)。

---

## 认证与 API Key

调用接口需要配置 BlockVectra API key。

- **Web 控制台开户**：前往 [BlockVectra 获取 API Key](https://blockvectra.com/zh/get-api-key/?ref=gh-robinhood-stock-tokens)。
- **程序化开户**：自动化脚本、CI 流水线或 AI Agent 可通过钱包签名（EIP-191）免浏览器自主开户，详见[程序化开户指南](https://docs.blockvectra.com/zh/guides/programmatic-signup/?ref=gh-robinhood-stock-tokens)。

配置环境变量：

```bash
export BLOCKVECTRA_API_KEY="your_api_key_here"
```

### 未携带 Key 时的行为

在未提供 API key 时发起请求：
- **Data API** 返回 HTTP `401 Unauthorized`，响应体为 `{"error":{"code":"missing_api_key","message":"missing API key: send it in the x-api-key header"}}`。CLI 会识别该状态并提示配置 `BLOCKVECTRA_API_KEY`。
- **JSON-RPC** 的鉴权行为取决于所配置端点的链与 method 策略：部分端点允许公开读取，另一些则要求身份信息或针对特定 method 提供 API key。可选的 multiplier 路径复用同一个 `BLOCKVECTRA_API_KEY` 并通过 `x-api-key` 传递，因此本示例不需要额外的 RPC 凭据。

---

## 运行要求

- **Node.js 24 或更高版本**。`start` 脚本使用 Node 内置的 `--env-file-if-exists` 参数。

---

## 安装与运行

1. **安装依赖**：
   ```bash
   npm install
   ```

2. **配置环境变量**：
   ```bash
   cp .env.example .env
   # 在 .env 中填入 BLOCKVECTRA_API_KEY
   ```

   `npm start` 会在 `.env` 存在时自动读取。已经导出的环境变量优先于 `.env` 中的同名值，例如已有的 `BLOCKVECTRA_API_KEY` 会覆盖文件中的配置。也可以不创建 `.env`，直接导出 `BLOCKVECTRA_API_KEY`（以及可选的端点覆盖变量）；没有 `.env` 时 `npm start` 同样可以运行。

---

## 使用方法

### 1. 查看股票代币每日活跃榜单

默认按当日转账活跃度降序展示前 10 个代币：

```bash
npm start
```

默认只发起 1 次 Data API 请求，不发起任何 JSON-RPC 请求。表头会显示请求的 UTC 日期（未指定时为 `latest recorded`）以及响应元数据；每一行显示该行实际记录的 UTC `Day`。

### 2. 指定日期与返回数量

```bash
# 查询指定 UTC 日期并返回前 5 项
npm start -- --day 2026-09-30 --limit 5
```

### 3. 查看单个代币详细指标

查询指定代币合约元数据及近期每日链上活动：

```bash
npm start -- --token 0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D
```

### 4. 读取公司行动乘数（可选）

只有显式传入 `--with-multiplier` 时才会查询 `uiMultiplier()`。CLI 会先确认 RPC 端点报告的 chain ID 为 `4663`，然后按顺序读取代币乘数；榜单模式最多读取前 10 行：

```bash
npm start -- --with-multiplier
npm start -- --token 0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D --with-multiplier
```

chain ID 不符或无法验证时，会在任何 `eth_call` 之前以非零状态退出。单行读取失败显示 `unavailable`，超过 10 次调用上限的行显示 `not queried (limit 10)`。CLI 不会用 0 或猜测值填充失败结果。

### 5. 命令行参数

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--token <address>` | 查询指定股票代币合约详情与近期历史指标 | 无 |
| `--day <YYYY-MM-DD>` | 查询指定 UTC 日期的活跃榜单 | 最新记录日期 |
| `--limit <number>` | 榜单展示条数（1–500） | `10` |
| `--with-multiplier` | 校验 chain ID `4663` 并通过 JSON-RPC 读取 `uiMultiplier()` | 关闭 |
| `--help`, `-h` | 查看帮助说明 | |

---

## 请求预算、数据新鲜度与输出

- **默认预算**：恰好 1 次 Data API `GET`、0 次 JSON-RPC 请求。未传入 `--with-multiplier` 时不会创建 RPC client。
- **可选路径预算**：最多 1 次 Data API `GET`、1 次 `eth_chainId` 校验和 10 次顺序执行的 `eth_call`，合计最多 12 次请求。乘数读取不并发，也不重试。
- **超时**：每次 Data API 请求使用 `AbortSignal.timeout(10_000)`；JSON-RPC transport 使用 `timeout: 10_000` 和 `retryCount: 0`。
- **日期**：榜单表头打印请求的 UTC `--day` 或 `latest recorded`；榜单每一行打印该行实际记录的 `Day`。单代币模式保留近期每日活动表中的 `Day` 列。
- **元数据**：两种模式都会打印响应原始的 `meta.refreshed_at` 与 `meta.as_of_block`；字段缺失或为 null 时显示 `unknown`。`refreshed_at` 缺失或为 null 时还会打印 `Freshness: unknown (treat as stale)`。仅有 `as_of_block` 不代表数据是当日数据，也不代表实时行情。
- **空结果**：先输出元数据，再输出原有的 `No stock tokens recorded for the requested date.` 信息，命令以 `0` 退出且不发起任何 RPC 请求。
- **不新增陈旧时长阈值**：CLI 只报告来源元数据，把新鲜度判断留给调用方；不会自行定义时间窗口，也不会改变乘数计算公式与精度。

---

## 参考文档

- [BlockVectra Robinhood Chain 指南](https://docs.blockvectra.com/zh/guides/robinhood-chain/?ref=gh-robinhood-stock-tokens)
- [BlockVectra 代币化股票数据指南](https://docs.blockvectra.com/zh/guides/stocks/?ref=gh-robinhood-stock-tokens)
- [BlockVectra 股票代币乘数指南](https://docs.blockvectra.com/zh/guides/stock-token-multiplier/?ref=gh-robinhood-stock-tokens)
- [Robinhood Chain 股票代币 API 规范](https://docs.robinhood.com/chain/stock-token-apis/)
- [BlockVectra 定价与计划](https://blockvectra.com/zh/pricing/?ref=gh-robinhood-stock-tokens)

---

## 许可证

[MIT](LICENSE)

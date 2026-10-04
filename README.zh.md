# Robinhood Chain 股票代币链上活动看板（命令行版）

本示例展示如何通过 BlockVectra Data API 与 JSON-RPC，在命令行中查询 Robinhood Chain 上股票代币的链上活动数据及合约状态。

> **免责声明**：链上活动数据，不是股价，不构成投资建议。

---

## 概述

Robinhood Chain 支持代币化真实世界资产（RWA），包括由 Robinhood Assets (Jersey) Limited (RHJ) 发行的代币化股票与 ETF。此类代币遵循 **ERC-8056（Scaled UI Amount Extension）** 规范，通过合约内乘数支持拆股等公司行动，而无需变动持有者钱包余额。

本项目使用同一个 API key 组合调用 BlockVectra 的两个接口服务：
1. **BlockVectra Data API**：通过 `GET /v1/data/robinhood_mainnet/stocks` 获取代币化股票的每日聚合链上指标（持有人数、转账数、活跃收发地址、DEX 成交量等）。
2. **BlockVectra JSON-RPC**：通过 `eth_call` 直接读取代币合约的 `uiMultiplier()` 方法获取链上最新乘数。

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
- **Data API** 返回 HTTP `401 Unauthorized`，响应体为 `{"error":{"code":"missing_api_key","message":"missing API key: send it in the x-api-key header"}}`。
- **JSON-RPC** 返回 HTTP `401 Unauthorized`，错误码为 `-32024`（`missing_api_key`）。

CLI 会捕获该未授权状态并提示配置环境变量。

---

## 安装与运行

1. **安装依赖**：
   ```bash
   npm install
   ```

2. **配置环境变量**（可选）：
   ```bash
   cp .env.example .env
   # 在 .env 中填入 BLOCKVECTRA_API_KEY
   ```

---

## 使用方法

### 1. 查看股票代币每日活跃榜单

默认按当日转账活跃度降序展示前 10 个代币：

```bash
npm start
```

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

### 4. 命令行参数

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--token <address>` | 查询指定股票代币合约详情与近期历史指标 | 无 |
| `--day <YYYY-MM-DD>` | 查询指定 UTC 日期的活跃榜单 | 最新记录日期 |
| `--limit <number>` | 榜单展示条数（1–500） | `10` |
| `--help`, `-h` | 查看帮助说明 | |

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

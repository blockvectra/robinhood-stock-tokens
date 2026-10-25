import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const evidenceRoot = path.join(repoRoot, ".evidence", "first-use");
const fixturesRoot = path.join(evidenceRoot, "fixtures");
const tokenAddress = "0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D";
const dummyKey = "dummy-first-use-key";
const dataApi = "https://dummy.first-use.invalid/data";
const rpcUrl = "https://dummy.first-use.invalid/rpc";

const preloadSource = `import { appendFileSync } from "node:fs";

const config = JSON.parse(process.env.FIRST_USE_FAKE_CONFIG || "{}");
const logPath = process.env.FIRST_USE_LOG || "";
let count = 0;
let ethCallCount = 0;
let active = 0;

function record(entry) {
  if (logPath) appendFileSync(logPath, JSON.stringify(entry) + "\\n");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

globalThis.fetch = async function (input, init = {}) {
  count += 1;
  active += 1;
  const url = requestUrl(input);
  const httpMethod = init.method || (input instanceof Request ? input.method : "GET");
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  let rpcMethod = null;
  let rpcId = null;
  if (typeof init.body === "string") {
    try {
      const payload = JSON.parse(init.body);
      rpcMethod = payload.method || null;
      rpcId = payload.id ?? null;
    } catch {}
  }
  const kind = httpMethod === "GET" ? "data" : rpcMethod || httpMethod;
  const entry = {
    count,
    kind,
    url,
    apiKey: headers.get("x-api-key") || "",
    active,
    hasSignal: Boolean(init.signal),
  };
  record(entry);

  try {
    if (httpMethod === "GET") {
      if (config.requireSignal && !init.signal) {
        return json({ error: "data request had no abort signal" }, 500);
      }
      const dataResponse = config.data || { status: 200, body: { data: [], meta: {} } };
      return json(dataResponse.body, dataResponse.status || 200);
    }

    if (rpcMethod === "eth_chainId") {
      if (config.chainId === "error") {
        return json({ error: { message: "unverifiable chain at " + url } }, 500);
      }
      return json({
        jsonrpc: "2.0",
        id: rpcId,
        result: "0x" + Number(config.chainId ?? 4663).toString(16),
      });
    }

    if (rpcMethod === "eth_call") {
      ethCallCount += 1;
      entry.ethCallIndex = ethCallCount;
      if (config.ethCallDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, config.ethCallDelayMs));
      }
      if (config.failEthCallAt && entry.ethCallIndex === config.failEthCallAt) {
        return json({ error: "transport failure for " + url }, 500);
      }
      const result = "0x" + (10n ** 18n).toString(16).padStart(64, "0");
      return json({ jsonrpc: "2.0", id: rpcId, result });
    }

    return json({ error: "unexpected rpc method " + String(rpcMethod) }, 400);
  } finally {
    active -= 1;
  }
};
`;

function cleanInheritedEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("BLOCKVECTRA_") || key.startsWith("FIRST_USE_")) {
      delete env[key];
    }
  }
  delete env.NODE_OPTIONS;
  return env;
}

function row(overrides = {}) {
  return {
    day: "2026-09-30",
    token: tokenAddress,
    symbol: "TEST",
    name: "Test Stock",
    transfers: 7,
    unique_senders: 3,
    unique_receivers: 4,
    mint_raw_amount: "0",
    burn_raw_amount: "0",
    net_supply_change: "0",
    holder_count: 42,
    top10_holder_share_bps: 1234,
    dex_swap_count: 2,
    dex_raw_volume: "0",
    refreshed_at: "2026-09-30T01:02:03Z",
    ...overrides,
  };
}

function tokenEnvelope(overrides = {}) {
  return {
    data: {
      address: tokenAddress,
      symbol: "TEST",
      name: "Test Stock",
      decimals: 18,
      daily: [
        {
          day: "2026-09-30",
          transfers: 7,
          unique_senders: 3,
          unique_receivers: 4,
          holder_count: 42,
          top10_holder_share_bps: 1234,
          dex_swap_count: 2,
        },
      ],
      ...overrides,
    },
    meta: { refreshed_at: "2026-09-30T01:02:03Z", as_of_block: 987654 },
  };
}

async function createFixture(label) {
  await mkdir(fixturesRoot, { recursive: true });
  const fixture = await mkdtemp(path.join(fixturesRoot, `${label}-`));
  await cp(path.join(repoRoot, "src"), path.join(fixture, "src"), { recursive: true });
  await copyFile(path.join(repoRoot, "package.json"), path.join(fixture, "package.json"));
  await symlink(path.join(repoRoot, "node_modules"), path.join(fixture, "node_modules"), "dir");
  await writeFile(path.join(fixture, "first-use-preload.mjs"), preloadSource, "utf8");
  return fixture;
}

function stopOwnedChild(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process already exited.
    }
  }
}

function runCli(fixture, options = {}) {
  const childEnv = cleanInheritedEnv();
  childEnv.NODE_OPTIONS = `--import=${pathToFileURL(path.join(fixture, "first-use-preload.mjs")).href}`;
  childEnv.BLOCKVECTRA_API_KEY = dummyKey;
  childEnv.BLOCKVECTRA_DATA_API_URL = options.dataApi || dataApi;
  childEnv.BLOCKVECTRA_RPC_URL = options.rpcUrl || rpcUrl;
  childEnv.FIRST_USE_FAKE_CONFIG = JSON.stringify(options.config || {});
  childEnv.FIRST_USE_LOG = path.join(fixture, "first-use-fetch.log");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import=tsx", "src/index.ts", ...(options.args || [])], {
      cwd: fixture,
      env: childEnv,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      stopOwnedChild(child);
    }, 20_000);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", async (code, signal) => {
      clearTimeout(timer);
      let requests = [];
      try {
        const log = await readFile(path.join(fixture, "first-use-fetch.log"), "utf8");
        requests = log
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      resolve({ code, signal, timedOut, stdout, stderr, requests });
    });
  });
}

function describe(result) {
  return [
    `exit code: ${result.code}`,
    `signal: ${result.signal}`,
    `timed out: ${result.timedOut}`,
    `requests: ${JSON.stringify(result.requests)}`,
    "stdout:",
    result.stdout,
    "stderr:",
    result.stderr,
  ].join("\n");
}

function assertCliSucceeded(result) {
  assert.equal(result.timedOut, false, `CLI timed out\n${describe(result)}`);
  assert.equal(result.signal, null, `CLI was terminated\n${describe(result)}`);
  assert.equal(result.code, 0, `CLI failed\n${describe(result)}`);
}

function requestKinds(result) {
  return result.requests.map((request) => request.kind);
}

function maxConcurrent(result) {
  return Math.max(0, ...result.requests.map((request) => request.active || 0));
}

test("default leaderboard uses one Data GET and zero RPC", async (t) => {
  const fixture = await createFixture("default-one-get");
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const config = {
    requireSignal: true,
    data: {
      status: 200,
      body: {
        data: [row()],
        meta: { refreshed_at: "2026-09-30T01:02:03Z", as_of_block: 987654 },
      },
    },
  };

  const result = await runCli(fixture, { config });
  assertCliSucceeded(result);
  assert.deepEqual(requestKinds(result), ["data"]);
  assert.equal(result.requests[0].url, `${dataApi}/robinhood_mainnet/stocks?limit=10`);
  assert.equal(result.requests[0].apiKey, dummyKey);
  assert.equal(result.requests[0].hasSignal, true, "Data GET must pass an abort signal");
  assert.match(result.stdout, /Requested day: latest recorded/);
  assert.match(result.stdout, /Data refreshed at: 2026-09-30T01:02:03Z/);
  assert.match(result.stdout, /Data as of block: 987654/);
  assert.match(result.stdout, /TEST/);
  assert.doesNotMatch(result.stdout, /Multiplier/);
});

test("--token without the multiplier flag uses one Data GET and zero RPC", async (t) => {
  const fixture = await createFixture("token-one-get");
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const config = { data: { status: 200, body: tokenEnvelope() } };

  const result = await runCli(fixture, { args: ["--token", tokenAddress], config });
  assertCliSucceeded(result);
  assert.deepEqual(requestKinds(result), ["data"]);
  assert.equal(result.requests[0].url, `${dataApi}/robinhood_mainnet/stocks/${tokenAddress}`);
  assert.match(result.stdout, /Token: Test Stock \(TEST\)/);
  assert.match(result.stdout, /Data refreshed at: 2026-09-30T01:02:03Z/);
  assert.match(result.stdout, /Data as of block: 987654/);
  assert.match(result.stdout, /Day/);
  assert.match(result.stdout, /2026-09-30/);
  assert.doesNotMatch(result.stdout, /Corporate Action Multiplier/);
});

test("--help works with and without --token and documents the opt-in budget", async (t) => {
  const fixture = await createFixture("help-modes");
  t.after(() => rm(fixture, { recursive: true, force: true }));

  const defaultHelp = await runCli(fixture, { args: ["--help"] });
  const tokenHelp = await runCli(fixture, { args: ["--token", tokenAddress, "--help"] });
  assertCliSucceeded(defaultHelp);
  assertCliSucceeded(tokenHelp);
  assert.deepEqual(defaultHelp.requests, []);
  assert.deepEqual(tokenHelp.requests, []);
  for (const result of [defaultHelp, tokenHelp]) {
    assert.match(result.stdout, /--with-multiplier/);
    assert.match(result.stdout, /Request budget/);
    assert.match(result.stdout, /4663/);
    assert.match(result.stdout, /Usage: pnpm start/);
  }
});

test("--with-multiplier verifies chain first and caps queries at 10 sequential calls", async (t) => {
  const fixture = await createFixture("optin-budget");
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const rows = Array.from({ length: 12 }, (_, index) =>
    row({ token: `0x${String(index + 1).padStart(40, "0")}`, symbol: `T${index + 1}` })
  );
  const config = {
    chainId: 4663,
    ethCallDelayMs: 25,
    data: {
      status: 200,
      body: { data: rows, meta: { refreshed_at: "2026-09-30T01:02:03Z", as_of_block: 987654 } },
    },
  };

  const result = await runCli(fixture, { args: ["--with-multiplier", "--limit", "20"], config });
  assertCliSucceeded(result);
  assert.equal(result.requests.length, 12, `expected 12 requests\n${describe(result)}`);
  assert.deepEqual(requestKinds(result), [
    "data",
    "eth_chainId",
    ...Array.from({ length: 10 }, () => "eth_call"),
  ]);
  assert.equal(maxConcurrent(result), 1, `multiplier calls must be sequential\n${describe(result)}`);
  for (const request of result.requests.slice(1)) {
    assert.equal(request.apiKey, dummyKey, "RPC requests must reuse the API key");
  }
  assert.match(result.stdout, /1\.0000x/);
  assert.match(result.stdout, /not queried \(limit 10\)/);
  assert.match(result.stdout, /T12/);
  assert.doesNotMatch(result.stdout, /unavailable/);
});

test("--with-multiplier does not retry a failed call and never invents a value", async (t) => {
  const fixture = await createFixture("optin-no-retry");
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const rows = Array.from({ length: 12 }, (_, index) =>
    row({ token: `0x${String(index + 1).padStart(40, "0")}`, symbol: `F${index + 1}` })
  );
  const config = {
    chainId: 4663,
    ethCallDelayMs: 10,
    failEthCallAt: 2,
    data: {
      status: 200,
      body: { data: rows, meta: { refreshed_at: "2026-09-30T01:02:03Z", as_of_block: 987654 } },
    },
  };

  const result = await runCli(fixture, { args: ["--with-multiplier", "--limit", "20"], config });
  assertCliSucceeded(result);
  assert.equal(result.requests.length, 12, `failed call must not be retried\n${describe(result)}`);
  assert.equal(requestKinds(result).filter((kind) => kind === "eth_call").length, 10);
  assert.equal(maxConcurrent(result), 1, `multiplier calls must be sequential\n${describe(result)}`);
  assert.match(result.stdout, /unavailable/);
  assert.match(result.stdout, /not queried \(limit 10\)/);
  assert.doesNotMatch(result.stdout, /0\.0000x/);
  assert.doesNotMatch(result.stdout, /N\/A/);
});

test("--with-multiplier on a token queries one multiplier after chain verification", async (t) => {
  const fixture = await createFixture("token-optin");
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const config = { chainId: 4663, data: { status: 200, body: tokenEnvelope() } };

  const result = await runCli(fixture, { args: ["--token", tokenAddress, "--with-multiplier"], config });
  assertCliSucceeded(result);
  assert.deepEqual(requestKinds(result), ["data", "eth_chainId", "eth_call"]);
  assert.match(result.stdout, /Corporate Action Multiplier: 1\.0000x/);
});

test("a wrong chain aborts before eth_call with a concise, secret-free error", async (t) => {
  const fixture = await createFixture("wrong-chain");
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const secretUrl = "https://dummy.first-use.invalid/secret-rpc-path";
  const config = {
    chainId: 1,
    data: { status: 200, body: { data: [row()], meta: { refreshed_at: "2026-09-30T01:02:03Z" } } },
  };

  const result = await runCli(fixture, {
    args: ["--with-multiplier"],
    rpcUrl: secretUrl,
    config,
  });
  assert.notEqual(result.code, 0, `wrong chain must fail\n${describe(result)}`);
  assert.equal(result.timedOut, false);
  assert.deepEqual(requestKinds(result), ["data", "eth_chainId"]);
  assert.match(result.stderr, /chain ID 1 does not match Robinhood Chain \(4663\)/);
  assert.doesNotMatch(result.stderr, /secret-rpc-path/);
  assert.doesNotMatch(result.stderr, /viem/i);
  assert.doesNotMatch(result.stderr, /https?:\/\//);
});

test("an unverifiable chain aborts before eth_call with a concise, secret-free error", async (t) => {
  const fixture = await createFixture("unverifiable-chain");
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const secretUrl = "https://dummy.first-use.invalid/secret-rpc-path";
  const config = {
    chainId: "error",
    data: { status: 200, body: { data: [row()], meta: { refreshed_at: "2026-09-30T01:02:03Z" } } },
  };

  const result = await runCli(fixture, {
    args: ["--with-multiplier"],
    rpcUrl: secretUrl,
    config,
  });
  assert.notEqual(result.code, 0, `unverifiable chain must fail\n${describe(result)}`);
  assert.equal(result.timedOut, false);
  assert.deepEqual(requestKinds(result), ["data", "eth_chainId"]);
  assert.match(result.stderr, /Unable to verify RPC chain ID/);
  assert.doesNotMatch(result.stderr, /secret-rpc-path/);
  assert.doesNotMatch(result.stderr, /viem/i);
  assert.doesNotMatch(result.stderr, /https?:\/\//);
});

test("empty data prints metadata before the empty message and makes no RPC call", async (t) => {
  const fixture = await createFixture("empty-data");
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const config = {
    chainId: 4663,
    data: {
      status: 200,
      body: { data: [], meta: { refreshed_at: "2026-09-30T04:05:06Z", as_of_block: 123456 } },
    },
  };

  const result = await runCli(fixture, { args: ["--with-multiplier"], config });
  assertCliSucceeded(result);
  assert.deepEqual(requestKinds(result), ["data"]);
  const refreshedIndex = result.stdout.indexOf("Data refreshed at: 2026-09-30T04:05:06Z");
  const emptyIndex = result.stdout.indexOf("No stock tokens recorded for the requested date.");
  assert.notEqual(refreshedIndex, -1, `metadata missing\n${describe(result)}`);
  assert.notEqual(emptyIndex, -1, `empty message missing\n${describe(result)}`);
  assert.ok(refreshedIndex < emptyIndex, `metadata must precede the empty message\n${describe(result)}`);
  assert.match(result.stdout, /Data as of block: 123456/);
});

test("missing and null metadata report unknown freshness and do not claim current data", async (t) => {
  for (const [label, meta] of [
    ["missing", {}],
    ["null", { refreshed_at: null, as_of_block: null }],
  ]) {
    await t.test(label, async (t) => {
      const fixture = await createFixture(`meta-${label}`);
      t.after(() => rm(fixture, { recursive: true, force: true }));
      const config = { data: { status: 200, body: { data: [row()], meta } } };

      const result = await runCli(fixture, { config });
      assertCliSucceeded(result);
      assert.match(result.stdout, /Data refreshed at: unknown/);
      assert.match(result.stdout, /Data as of block: unknown/);
      assert.match(result.stdout, /Freshness: unknown \(treat as stale\)/);
      assert.doesNotMatch(result.stdout, /current[- ]day/i);
    });
  }
});

test("requested day and each row's recorded UTC day are printed", async (t) => {
  const fixture = await createFixture("actual-days");
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const config = {
    data: {
      status: 200,
      body: {
        data: [row({ day: "2026-09-29" }), row({ day: "2026-09-30" })],
        meta: { refreshed_at: "2026-10-01T00:00:00Z", as_of_block: 555555 },
      },
    },
  };

  const result = await runCli(fixture, { args: ["--day", "2026-09-30"], config });
  assertCliSucceeded(result);
  assert.match(result.stdout, /Requested day: 2026-09-30 \(UTC\)/);
  assert.match(result.stdout, /2026-09-29/);
  assert.match(result.stdout, /2026-09-30/);
  assert.match(result.stdout, /Data refreshed at: 2026-10-01T00:00:00Z/);
  assert.match(result.stdout, /Data as of block: 555555/);
});

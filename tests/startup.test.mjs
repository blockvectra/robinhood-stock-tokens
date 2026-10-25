import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const evidenceRoot = path.join(repoRoot, ".evidence");
const preloadSource = `import { appendFileSync } from "node:fs";

const isNpmCli = /[\\\\/]npm-cli\\.js$/.test(process.argv[1] || "");
if (!isNpmCli) {
  const expectedKey = process.env.STARTUP_TEST_EXPECTED_KEY || "";
  const expectedUrl = process.env.STARTUP_TEST_EXPECTED_URL || "";
  const expectedFetches = Number(process.env.STARTUP_TEST_EXPECTED_FETCHES || "0");
  const logPath = process.env.STARTUP_TEST_FETCH_LOG || "";
  let fetchCount = 0;

  function record(entry) {
    if (logPath) appendFileSync(logPath, JSON.stringify(entry) + "\\n");
  }

  globalThis.fetch = async function (input, init) {
    fetchCount += 1;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const headers = new Headers(
      init && init.headers
        ? init.headers
        : input instanceof Request
          ? input.headers
          : undefined
    );
    const apiKey = headers.get("x-api-key") || "";
    record({ count: fetchCount, url: url, apiKey: apiKey });

    if (fetchCount > expectedFetches) {
      throw new Error("[startup-test] unexpected fetch #" + fetchCount + " for " + url);
    }
    if (url !== expectedUrl) {
      throw new Error("[startup-test] fetched URL " + JSON.stringify(url) + ", expected " + JSON.stringify(expectedUrl));
    }
    if (apiKey !== expectedKey) {
      throw new Error("[startup-test] fetched API key " + JSON.stringify(apiKey) + ", expected " + JSON.stringify(expectedKey));
    }

    return new Response(JSON.stringify({ data: [], meta: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  process.on("beforeExit", function () {
    if (fetchCount !== expectedFetches) {
      console.error("[startup-test] expected " + expectedFetches + " fetch(es), got " + fetchCount);
      process.exitCode = 1;
    }
  });
}
`;

function cleanInheritedEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("BLOCKVECTRA_") || key.startsWith("STARTUP_TEST_")) {
      delete env[key];
    }
  }
  delete env.NODE_OPTIONS;
  return env;
}

function envFile({ key, dataApi, rpc }) {
  return [
    `BLOCKVECTRA_API_KEY=${key}`,
    `BLOCKVECTRA_DATA_API_URL=${dataApi}`,
    `BLOCKVECTRA_RPC_URL=${rpc}`,
    "",
  ].join("\n");
}

async function createFixture(label, dotenv) {
  await mkdir(evidenceRoot, { recursive: true });
  const fixture = await mkdtemp(path.join(evidenceRoot, `startup-${label}-`));
  await cp(path.join(repoRoot, "src"), path.join(fixture, "src"), { recursive: true });
  await copyFile(path.join(repoRoot, "package.json"), path.join(fixture, "package.json"));
  await copyFile(path.join(repoRoot, "package-lock.json"), path.join(fixture, "package-lock.json"));
  await symlink(path.join(repoRoot, "node_modules"), path.join(fixture, "node_modules"), "dir");
  await writeFile(path.join(fixture, "startup-fetch-preload.mjs"), preloadSource, "utf8");
  if (dotenv) {
    await writeFile(path.join(fixture, ".env"), dotenv, "utf8");
  }
  return fixture;
}

function stopProcessGroup(child) {
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

function runNpmStart(fixture, options) {
  const childEnv = cleanInheritedEnv();
  Object.assign(childEnv, options.env || {});
  childEnv.NODE_OPTIONS = `--import=${pathToFileURL(path.join(fixture, "startup-fetch-preload.mjs")).href}`;
  childEnv.STARTUP_TEST_EXPECTED_KEY = options.expectedKey;
  childEnv.STARTUP_TEST_EXPECTED_URL = options.expectedUrl;
  childEnv.STARTUP_TEST_EXPECTED_FETCHES = String(options.expectedFetches);
  childEnv.STARTUP_TEST_FETCH_LOG = path.join(fixture, "startup-fetch.log");

  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["start", ...(options.args || [])], {
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
      stopProcessGroup(child);
    }, 20_000);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", async (code, signal) => {
      clearTimeout(timer);
      let requests = [];
      try {
        const log = await readFile(path.join(fixture, "startup-fetch.log"), "utf8");
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

function assertSuccessfulStart(result) {
  assert.equal(result.timedOut, false, `npm start timed out\n${describe(result)}`);
  assert.equal(result.signal, null, `npm start was terminated\n${describe(result)}`);
  assert.equal(result.code, 0, `npm start failed\n${describe(result)}`);
}

test(".env is loaded when npm start runs with no exported API settings", async (t) => {
  const dotenvValues = {
    key: "dummy-dotenv-only-key",
    dataApi: "https://dummy.startup.invalid/dotenv-data",
    rpc: "https://dummy.startup.invalid/dotenv-rpc",
  };
  const fixture = await createFixture("dotenv-only", envFile(dotenvValues));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const expectedUrl = `${dotenvValues.dataApi}/robinhood_mainnet/stocks?limit=10`;

  const result = await runNpmStart(fixture, {
    expectedKey: dotenvValues.key,
    expectedUrl,
    expectedFetches: 1,
  });
  assertSuccessfulStart(result);
  assert.match(result.stdout, /No stock tokens recorded for the requested date\./);
  assert.deepEqual(result.requests, [{ count: 1, url: expectedUrl, apiKey: dotenvValues.key }]);
});

test("exported API settings override values from .env", async (t) => {
  const dotenvValues = {
    key: "dummy-dotenv-overridden-key",
    dataApi: "https://dummy.startup.invalid/dotenv-overridden-data",
    rpc: "https://dummy.startup.invalid/dotenv-overridden-rpc",
  };
  const exportedValues = {
    key: "dummy-export-wins-key",
    dataApi: "https://dummy.startup.invalid/export-wins-data",
    rpc: "https://dummy.startup.invalid/export-wins-rpc",
  };
  const fixture = await createFixture("export-overrides-dotenv", envFile(dotenvValues));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const expectedUrl = `${exportedValues.dataApi}/robinhood_mainnet/stocks?limit=10`;

  const result = await runNpmStart(fixture, {
    env: {
      BLOCKVECTRA_API_KEY: exportedValues.key,
      BLOCKVECTRA_DATA_API_URL: exportedValues.dataApi,
      BLOCKVECTRA_RPC_URL: exportedValues.rpc,
    },
    expectedKey: exportedValues.key,
    expectedUrl,
    expectedFetches: 1,
  });
  assertSuccessfulStart(result);
  assert.match(result.stdout, /No stock tokens recorded for the requested date\./);
  assert.deepEqual(result.requests, [{ count: 1, url: expectedUrl, apiKey: exportedValues.key }]);
});

test("export-only setup works without a .env file", async (t) => {
  const exportedValues = {
    key: "dummy-export-only-key",
    dataApi: "https://dummy.startup.invalid/export-only-data",
    rpc: "https://dummy.startup.invalid/export-only-rpc",
  };
  const fixture = await createFixture("export-only");
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const expectedUrl = `${exportedValues.dataApi}/robinhood_mainnet/stocks?limit=10`;

  const result = await runNpmStart(fixture, {
    env: {
      BLOCKVECTRA_API_KEY: exportedValues.key,
      BLOCKVECTRA_DATA_API_URL: exportedValues.dataApi,
      BLOCKVECTRA_RPC_URL: exportedValues.rpc,
    },
    expectedKey: exportedValues.key,
    expectedUrl,
    expectedFetches: 1,
  });
  assertSuccessfulStart(result);
  assert.match(result.stdout, /No stock tokens recorded for the requested date\./);
  assert.deepEqual(result.requests, [{ count: 1, url: expectedUrl, apiKey: exportedValues.key }]);
});

test("--help works without a .env file and makes no fetch request", async (t) => {
  const fixture = await createFixture("help-no-dotenv");
  t.after(() => rm(fixture, { recursive: true, force: true }));

  const result = await runNpmStart(fixture, {
    args: ["--", "--help"],
    expectedKey: "dummy-unused-key",
    expectedUrl: "https://dummy.startup.invalid/unused",
    expectedFetches: 0,
  });
  assertSuccessfulStart(result);
  assert.match(result.stdout, /Usage: pnpm start/);
  assert.deepEqual(result.requests, []);
});

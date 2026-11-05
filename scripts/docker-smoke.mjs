/* global fetch, AbortSignal, document, innerWidth */
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const image = process.argv[2];
assert(image, "Usage: node scripts/docker-smoke.mjs <image>");
assert(process.env.CHRONA_PLAYWRIGHT_ROOT, "Set CHRONA_PLAYWRIGHT_ROOT to the isolated Playwright installation");
const { chromium } = createRequire(resolve(process.env.CHRONA_PLAYWRIGHT_ROOT, "package.json"))("playwright");
const key = randomUUID();
const name = `chrona-smoke-${randomUUID()}`;
const docker = (...args) => {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 120_000 });
  assert.equal(result.status, 0, `docker ${args[0]} failed: ${String(result.stderr).replaceAll(key, "[REDACTED]")}`);
  return (args[0] === "logs" ? result.stdout + result.stderr : result.stdout).trim();
};

// A missing key must fail before database initialization, with no generated credentials.
for (const value of ["", "   "]) {
  const result = spawnSync("docker", ["run", "--rm", "-e", `API_KEY=${value}`, image], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /API_KEY is required/);
  assert.doesNotMatch(result.stdout + result.stderr, /Generated API_KEY/);
}

let browser;
let created = false;
try {
  docker("create", "--name", name, "--memory=2g", "--memory-swap=3g", "-p", "127.0.0.1::3101", "-e", `API_KEY=${key}`, image);
  created = true;
  docker("start", name);
  const address = docker("port", name, "3101/tcp");
  const base = `http://${address}`;
  const deadline = Date.now() + 120_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/web/today`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5_000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Initial migrations and built-in module checks may still be running. */ }
    await setTimeout(500);
  }
  assert(ready, "Container did not serve the authenticated web API within 120 seconds");
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/web/today`)).status, 401);
  assert.equal((await fetch(`${base}/api/web/today`, { headers: { authorization: "Bearer wrong-key" } })).status, 401);
  // The runtime migration runner must own initialization, including its checksum ledger.
  docker("exec", name, "bun", "-e", "import { Database } from 'bun:sqlite'; const db = new Database('/data/chrona.db', { readonly: true }); if (!db.query(\"SELECT name FROM sqlite_master WHERE name='Workspace'\").get() || !db.query('SELECT checksum FROM _chrona_migrations').get()) process.exit(1); db.close();");
  docker("exec", name, "bun", "--no-install", "packages/integrations/src/steward/module-typecheck/check.ts", "packages/engine/src/modules/steward/builtin/remind", "packages/integrations/src/steward/module-sdk");

  browser = await chromium.launch({ executablePath: process.env.CHRONA_CHROMIUM_PATH });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel("访问密钥", { exact: true }).waitFor();
    await page.getByLabel("访问密钥", { exact: true }).fill("wrong-key");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("密钥不正确，请重新输入。", { exact: true }).waitFor();
    await page.getByLabel("访问密钥", { exact: true }).fill(key);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByLabel("访问密钥", { exact: true }).waitFor({ state: "detached" });
    await page.getByRole("link", { name: "应用", exact: true }).click();
    await page.waitForURL("**/apps");
    await page.getByRole("link", { name: "web", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Horizontal overflow at ${viewport.width}px`);
    assert.deepEqual(errors, [], "Browser runtime errors");
    await page.close();
  }
  assert(!docker("logs", name).includes(key), "Container logs exposed API_KEY");
  console.log("Container smoke passed: key rejection, auth, migration, module typecheck, desktop/tablet/mobile browser login.");
} catch (error) {
  if (created) console.error(docker("logs", name).replaceAll(key, "[REDACTED]"));
  throw error;
} finally {
  try { await browser?.close(); }
  finally { if (created) docker("rm", "--force", "--volumes", name); }
}

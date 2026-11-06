import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { EXECUTION_PROTOCOL, editorResponseSchema } from "@chrona/contracts/steward";
import { createServerApp } from "./app";
import { createStewardRuntime } from "./steward-runtime";
import { resetEnvCacheForTests } from "./config/env";
import { db, resetTestDb } from "./__tests__/bun-test-helpers";
import { createEditorTransportFixture } from "./editor-transport-fixture.test";

let previousKey: string | undefined, dir: string, key: string;
let fixture: ReturnType<typeof createEditorTransportFixture>;
let runtime: ReturnType<typeof createStewardRuntime>;
let front: ReturnType<typeof Bun.serve>;
let connected = true;
beforeEach(async () => {
  previousKey = process.env.API_KEY; key = randomBytes(32).toString("hex"); process.env.API_KEY = key;
  resetEnvCacheForTests(); await resetTestDb(); dir = await mkdtemp("/tmp/chrona-p1-proxy-");
  fixture = createEditorTransportFixture(join(dir, "editor.sock"));
  runtime = createStewardRuntime(db, { provider: null, dataDir: dir });
  // Fake editor registration only; requests traverse the real Hono middleware and Unix proxy.
  connected = true; runtime.listener = async path => path === "/api/editor" ? connected ? join(dir, "editor.sock") : join(dir, "missing.sock") : null;
  const app = await createServerApp({ steward: runtime });
  front = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 30, fetch: app.fetch });
});
afterEach(async () => {
  fixture?.close(); front?.stop(true); await runtime?.stop(); await db?.$disconnect();
  if (dir) await rm(dir, { recursive: true, force: true });
  if (previousKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = previousKey;
  resetEnvCacheForTests();
});
const headers = () => ({ authorization: `Bearer ${key}`, "x-chrona-protocol": EXECUTION_PROTOCOL, "content-type": "application/json" });
const request = (path: string, init?: RequestInit) => {
  const url = new URL(`api/editor/v1/${path}`, front.url);
  if (path.startsWith("events")) {
    const view = fixture.ref();
    for (const [name, value] of Object.entries({ v: EXECUTION_PROTOCOL, requestId: "poll", workId: view?.workId, runId: view?.runId, attemptId: view?.attemptId })) if (value) url.searchParams.set(name, value);
  }
  return fetch(url, { ...init, headers: { ...headers(), ...init?.headers } });
};
const start = () => request("commands", { method: "POST", body: JSON.stringify({ v: EXECUTION_PROTOCOL, requestId: "start", command: { op: "start", workId: "probe-work", projectRef: "probe-project", commandKey: "submit", goal: "no model probe", budget: { timeoutMs: 60_000, maxToolCalls: 10 } } }) });
async function until(predicate: () => boolean, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < end) await Bun.sleep(10);
  expect(predicate()).toBe(true);
}
test("editor requires configured key before listener; other APIs retain existing auth defaults", async () => {
  const listener = runtime.listener;
  let calls = 0;
  runtime.listener = async path => { calls++; return listener(path); };
  for (const empty of [undefined, "", "   "]) {
    if (empty === undefined) delete process.env.API_KEY; else process.env.API_KEY = empty;
    resetEnvCacheForTests();
    const app = await createServerApp({ steward: runtime });
    const unconfigured = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
    try {
      const response = await fetch(new URL("/api/editor/v1/headers", unconfigured.url));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: "EDITOR_AUTH_UNCONFIGURED" });
      expect(calls).toBe(0);
      if (!empty) expect((await fetch(new URL("/api/not-editor/unknown", unconfigured.url))).status).toBe(404);
    } finally { unconfigured.stop(true); }
    calls = 0;
  }
  process.env.API_KEY = key; resetEnvCacheForTests(); calls = 0;
  expect((await request("headers", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  expect(calls).toBe(0);
  expect((await request("headers")).status).toBe(200);
  expect(calls).toBe(1);
  expect((await fetch(new URL("/api/not-editor/unknown", front.url))).status).toBe(401);
});
test("real auth/listen proxy: rejection, header stripping, version, body limits, idempotent POST and bounded read", async () => {
  expect((await request("headers", { headers: { authorization: "" } })).status).toBe(401);
  expect((await request("headers", { headers: { authorization: "Bearer incorrect" } })).status).toBe(401);
  expect((await request("headers", { headers: { origin: "https://untrusted.invalid" } })).status).toBe(403);
  const stripped = await request("headers", { headers: { cookie: "private=1" } });
  expect(await stripped.json()).toEqual({ auth: null, cookie: null, path: "/api/editor/v1/headers" });
  expect(stripped.headers.get("set-cookie")).toBeNull();
  expect((await request("commands", { method: "POST", body: JSON.stringify({ v: "v999", requestId: "version", command: { op: "get", workId: "probe-work" } }) })).status).toBe(409);
  expect((await request("commands", { method: "POST", body: "x".repeat(64 * 1024 + 1) })).status).toBe(413);
  expect((await request("commands", { method: "POST", body: "x".repeat(21 * 1024 * 1024 + 1) })).status).toBe(413);
  const first = await start(), view = editorResponseSchema.parse(await first.json());
  expect(first.status).toBe(200); expect(view.ok).toBe(true);
  expect(editorResponseSchema.parse(await (await start()).json())).toEqual(view); expect(fixture.fake.enqueued).toHaveLength(1);
  const forged = await request("commands", { method: "POST", body: JSON.stringify({ v: EXECUTION_PROTOCOL, requestId: "forged", command: { op: "get", workId: "probe-work", caller: "owner" } }) });
  expect(forged.status).toBe(400);
  const page = await request("events?limit=100&waitMs=0"); expect(page.status).toBe(200);
  expect(editorResponseSchema.parse(await page.json())).toMatchObject({ requestId: "poll", ok: true });
  expect((await request("events?limit=101&waitMs=0")).status).toBe(400);
  connected = false; expect((await request("headers")).status).toBe(503);
}, 10_000);
test("real 15-second bounded poll crosses authenticated TCP to Unix proxy", async () => {
  await (await start()).text(); const began = performance.now();
  const response = await request("events?limit=100&waitMs=15000");
  const body = editorResponseSchema.parse(await response.json()), elapsedMs = Math.round(performance.now() - began);
  expect(response.status).toBe(200); expect(body.ok).toBe(true);
  expect(elapsedMs).toBeGreaterThanOrEqual(14_900); expect(elapsedMs).toBeLessThan(20_000);
  expect(fixture.events.stats().waiters).toBe(0);
  expect(fixture.events.stats().activePolls).toBe(0);
  expect((await request("events?limit=1&waitMs=10")).status).toBe(200);
  console.log(JSON.stringify({ probe: "real-proxy-long-poll", elapsedMs, status: response.status, waiters: fixture.events.stats().waiters }));
}, 22_000);
test("owner poll cap returns 429; aborted client releases upstream waiter without cancelling execution", async () => {
  await (await start()).text();
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const polls = controllers.map(controller => request("events?limit=100&waitMs=15000", { signal: controller.signal }).then(response => response.text(), () => "aborted"));
  try {
    await until(() => fixture.events.stats().waiters === 4);
    expect((await request("events?limit=100&waitMs=10")).status).toBe(429);
    for (const controller of controllers) controller.abort(); await Promise.all(polls);
    await until(() => fixture.events.stats().waiters === 0, 1000);
    expect(fixture.events.stats().activePolls).toBe(0);
    const resumed = await request("events?limit=1&waitMs=10");
    expect(resumed.status).toBe(200); await resumed.text();
    expect(fixture.events.stats().activePolls).toBe(0);
    expect((await fixture.fake.ports.get({ workspaceId: "probe-workspace", ownerId: "probe-owner", caller: { kind: "owner" } }, "probe-work")).cancelRequested).toBe(false);
  } finally { for (const controller of controllers) controller.abort(); }
}, 5000);

import { afterEach, beforeEach, expect, test } from "bun:test";
import { testDb } from "../../../packages/engine/src/modules/steward/test-db";
import { createStewardRuntime, type StewardRuntime } from "./steward-runtime";
import { createAgentSlot } from "./steward-agent-loop";
import { createStewardAgentRoutes } from "./routes/steward-agent.routes";
let db: ReturnType<typeof testDb>, runtime: StewardRuntime | undefined;
beforeEach(async () => { db = testDb(); await db.workspace.create({ data: { id: "w", name: "Test" } }); });
afterEach(async () => { await runtime?.stop(); runtime = undefined; await db.$disconnect(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

test("independent slots serialize each role and release after failure", async () => {
  const slot = createAgentSlot(), held = deferred(), chatHeld = deferred(), started = deferred(), chatStarted = deferred(), order: string[] = [];
  const first = slot("affair", async () => { started.resolve(); await held.promise; order.push("first"); });
  await started.promise;
  const next = slot("affair", async () => { order.push("next"); });
  const chat = slot("concierge", async () => { order.push("chat"); chatStarted.resolve(); await chatHeld.promise; throw new Error("failed"); }).catch(() => {});
  await chatStarted.promise;
  const nextChat = slot("concierge", async () => { order.push("nextChat"); });
  expect(order).toEqual(["chat"]);
  chatHeld.resolve(); await Promise.all([chat, nextChat]);
  expect(order).toEqual(["chat", "nextChat"]);
  held.resolve(); await Promise.all([first, next]);
  expect(order).toEqual(["chat", "nextChat", "first", "next"]);
});

test("loop claims and finishes using in-process capability HTTP; chat never waits for affair", async () => {
  const started = deferred(), release = deferred(), order: string[] = [];
  let count = 0;
  runtime = createStewardRuntime(db, { agent: {
    async runAffair({ token, shouldStop }) {
      order.push("affair"); expect(await shouldStop()).toBe(false);
      if (++count === 1) { started.resolve(); await release.promise; }
      const app = createStewardAgentRoutes(runtime!.ports, runtime!.service);
      const response = await app.request("http://localhost/tools/chrona_close", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ outcome: "done", reason: "Finished" }) });
      expect((await response.json()).ok).toBe(true);
    },
    async runConcierge({ token }) {
      order.push("concierge");
      expect((await runtime!.service.agentEndpoint.callTool(token, "concierge_reply", { text: "Hello" })).ok).toBe(true);
    },
  } });
  await runtime.service.forWorkspace("w").affairs.create({ request: "First" });
  await runtime.service.forWorkspace("w").affairs.create({ request: "Second" });
  const work = runtime.agent.runAgentOnce(); await started.promise;
  const chat = runtime.service.forWorkspace("w").chat.handleMessage({ channel: "in_app", text: "Hi" });
  try {
    expect((await chat).reply).toBe("Hello");
    expect(order).toEqual(["affair", "concierge"]);
  } finally { release.resolve(); }
  await work;
  expect(order).toEqual(["affair", "concierge", "affair"]);
  const runs = await db.affairRun.findMany();
  expect(runs).toHaveLength(2); expect(runs.every(r => r.status === "closed" && r.endedAt !== null)).toBe(true);
});

test("tick timer uses injected clock and is cleared at stop", async () => {
  let callback: (() => void) | undefined, interval = 0, cleared = false;
  let now = new Date("2026-01-01T12:00:00Z");
  const timers = {
    setInterval: ((fn: () => void, ms: number) => { callback = fn; interval = ms; return 1; }) as unknown as typeof setInterval,
    clearInterval: (() => { cleared = true; }) as typeof clearInterval,
  };
  runtime = createStewardRuntime(db, { agent: null, now: () => now, timers });
  runtime.start(); expect(interval).toBe(60_000);
  now = new Date("2026-01-01T12:01:00Z"); callback!(); await runtime.tickOnce();
  expect((await db.stewardState.findUniqueOrThrow({ where: { workspaceId: "w" } })).lastTickAt).toEqual(now);
  await runtime.stop(); expect(cleared).toBe(true);
});

test("production composition excludes test sources and timers stay disabled in tests", async () => {
  const saved = process.env.CHRONA_E2E_TEST_ROUTES; delete process.env.CHRONA_E2E_TEST_ROUTES;
  try {
    runtime = createStewardRuntime(db, { agent: null }); runtime.start();
    expect(runtime.localSource).toBeUndefined(); expect(runtime.delivery).toBeUndefined();
    expect(runtime.ports.sources.some(s => s.kind === "local_test")).toBe(false);
    expect(await db.stewardState.count()).toBe(0);
  } finally { if (saved !== undefined) process.env.CHRONA_E2E_TEST_ROUTES = saved; }
});

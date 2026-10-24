import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { moduleManifestSchema, type ModuleEvent } from "@chrona/contracts/steward";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { testDb } from "./test-db";
import { callsSettled, enqueueCall, kernelOrigin, runDueCalls } from "./module-calls";
import { callModuleTool } from "./module-tools";
import { registerSystemModules } from "./system-modules";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
type Handler = Parameters<typeof testModuleProcess>[0];
const tool = (name: string, extra: Record<string, unknown> = {}) => ({ name, description: name, parameters: { type: "object", properties: { text: { type: "string" } } }, visibility: ["modules"], ...extra });
const schedule: ModuleEvent = { trigger: { id: "daily", kind: "schedule", firedAt: "2026-10-24T00:00:00Z" }, now: "2026-10-24T00:00:00Z", params: {} };

/** Two modules, alpha (the caller) and beta (the callee), on the real supervisor, socket and database. */
async function fixture(handlers: { alpha: Handler; beta: Handler }) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/cmc-test-");
  const workspace = await db.workspace.create({ data: { name: "calls" } });
  const manifests = {
    alpha: { name: "alpha", entry: "index.ts", tests: ["test.ts"], effects: [], triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }],
      uses: ["beta.echo", "beta.private", "beta.hidden", "beta.bounce", "beta.crash", "beta.again"], tools: [tool("pong")] },
    beta: { name: "beta", entry: "index.ts", tests: ["test.ts"], effects: [], triggers: [], uses: ["alpha.pong"],
      tools: [tool("echo", { visibility: ["modules", "kernel"] }), tool("private", { callers: ["gamma"] }), tool("hidden", { visibility: ["provider", "owner"] }), tool("bounce", { visibility: ["modules", "kernel"] }), tool("crash", { visibility: ["modules", "kernel"] }), tool("again", { idempotent: true, visibility: ["modules", "kernel"] })] },
  };
  const modules: Record<string, { id: string }> = {};
  for (const [name, manifest] of Object.entries(manifests)) {
    const module = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: `${name}-v1` } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: `${name}-v1`, manifest: moduleManifestSchema.parse(manifest), source: "user", intent: {}, report: {}, status: "approved" } });
    modules[name] = module;
  }
  const peer = testModuleProcess((event, call, input) => (input.codeDir.endsWith("alpha-v1") ? handlers.alpha : handlers.beta)(event, call, input));
  let time = Date.parse("2026-10-24T00:00:00Z");
  const ports: StewardPorts = { db, dataDir, now: () => new Date(time), publicUrl: null, sandbox: { available: true, isolated: true, startModule: peer.startModule } };
  cleanups.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  return { db, ports, workspace, alpha: modules.alpha!, beta: modules.beta!, ...peer, advance: (ms: number) => { time += ms; },
    fire: () => moduleSupervisor(ports).deliver(modules.alpha!.id, "alpha-v1", schedule) };
}
const output = (reply: unknown) => (reply as { result: { result: unknown } }).result.result;

test("A calls B through Chrona: B sees the real caller and the call is recorded", async () => {
  const f = await fixture({
    alpha: async (_event, call) => ({ result: await call("call", { target: "beta.echo", args: { text: "hi" } } as never) }),
    beta: async event => ({ result: { echo: (event.trigger as unknown as { args: { text: string } }).args.text, caller: (event.trigger as { caller?: unknown }).caller } }),
  });
  expect(output(await f.fire())).toMatchObject({ result: { output: { echo: "hi", caller: { kind: "module", module: "alpha", moduleId: f.alpha.id, hash: "alpha-v1" } } } });
  expect(await f.db.moduleInvocation.findFirstOrThrow()).toMatchObject({ caller: `module:${f.alpha.id}`, callerModuleId: f.alpha.id, target: "beta", tool: "echo", mode: "sync", status: "succeeded", chain: ["alpha"] });
  expect(await f.db.moduleCall.findFirstOrThrow({ where: { moduleId: f.alpha.id } })).toMatchObject({ method: "call", status: "executed" });
});

test("undeclared targets, hidden tools and caller-restricted tools are refused; the owner API cannot reach module-only tools", async () => {
  const replies: unknown[] = [];
  const f = await fixture({
    alpha: async (_event, call) => {
      for (const target of ["beta.private", "beta.hidden", "beta.unlisted"]) replies.push(await call("call", { target, args: {} } as never));
      return {};
    },
    beta: async () => { throw new Error("must not be reached"); },
  });
  await f.fire();
  expect(replies).toMatchObject([{ error: { code: "forbidden" } }, { error: { code: "forbidden" } }, { error: { code: "undeclared" } }]);
  expect(await f.db.moduleRun.count({ where: { moduleId: f.beta.id } })).toBe(0);
  // Owner requests reach only owner-visible tools: beta.echo is for modules and Chrona.
  await expect(callModuleTool(f.ports, { workspaceId: f.workspace.id, runId: null, via: "mcp" }, "m_beta_echo", { text: "x" })).rejects.toMatchObject({ code: "not_found" });
});

test("a sync call back into a module that is waiting is refused as a cycle, not left to time out", async () => {
  const f = await fixture({
    alpha: async (event, call) => event.trigger.kind === "tool" ? { result: "pong" } : { result: await call("call", { target: "beta.bounce", args: {} } as never) },
    beta: async (_event, call) => ({ result: await call("call", { target: "alpha.pong", args: {}, mode: "sync" } as never) }),
  });
  const started = Date.now();
  expect(output(await f.fire())).toMatchObject({ result: { output: { error: { code: "cycle" } } } });
  expect(Date.now() - started).toBeLessThan(5000);
});

test("a sync call into a module that waits on the caller in another event is refused (cross-event deadlock)", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let betaReply: unknown;
  const f = await fixture({
    // alpha's scheduled event waits on beta.echo; beta answers only after its own other event called alpha.
    alpha: async (event, call) => event.trigger.kind === "tool" ? { result: "pong" } : { result: await call("call", { target: "beta.echo", args: {} } as never) },
    beta: async (event, call) => {
      if (event.trigger.id === "bounce") { await gate; betaReply = await call("call", { target: "alpha.pong", args: {} } as never); return { result: betaReply }; }
      return { result: "echo" };
    },
  });
  const started = Date.now();
  // beta is busy in "bounce" (Chrona's async call) when alpha starts waiting on beta.echo; then bounce calls alpha.
  await enqueueCall(f.db, f.ports, kernelOrigin(f.workspace.id), "beta.bounce", {}, { key: "bounce" });
  const delivering = runDueCalls(f.ports, f.workspace.id);
  await Bun.sleep(50);
  const alpha = f.fire();
  await Bun.sleep(50);
  release(); await delivering;
  expect(output(await alpha)).toMatchObject({ result: { output: "echo" } });
  expect(betaReply).toMatchObject({ error: { code: "cycle" } });
  expect(Date.now() - started).toBeLessThan(5000);
});

test("async calls are stored under the caller's key, delivered once and answered with call_result and callStatus", async () => {
  const results: unknown[] = [], deliveries: unknown[] = [];
  let callId = "";
  const f = await fixture({
    alpha: async (event, call) => {
      if (event.trigger.kind === "call_result") { results.push(event.trigger); return {}; }
      if (event.trigger.kind === "tool") return { result: await call("callStatus", { callId } as never) };
      const first = await call("call", { target: "beta.echo", args: { text: "once" }, mode: "async", key: "k1", reply: true } as never) as { result: { callId: string } };
      callId = first.result.callId;
      return { result: [first, await call("call", { target: "beta.echo", args: { text: "once" }, mode: "async", key: "k1", reply: true } as never)] };
    },
    beta: async event => { deliveries.push(event.trigger); return { result: { echo: (event.trigger as unknown as { args: { text: string } }).args.text } }; },
  });
  expect(output(await f.fire())).toMatchObject([{ result: { status: "queued", duplicate: false } }, { result: { callId: expect.any(String), duplicate: true } }]);
  // The call itself started a delivery loop; let it finish, then run once more (nothing is delivered twice).
  await callsSettled(f.ports); await runDueCalls(f.ports, f.workspace.id); await callsSettled(f.ports);
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]).toMatchObject({ kind: "tool", id: "echo", caller: { kind: "module", module: "alpha" }, call: { id: callId, key: "k1", attempt: 1, chain: ["alpha"] } });
  expect(results).toMatchObject([{ kind: "call_result", callId, target: "beta.echo", key: "k1", status: "succeeded", output: { echo: "once" } }]);
  const status = await moduleSupervisor(f.ports).deliver(f.alpha.id, "alpha-v1", { trigger: { id: "pong", kind: "tool", firedAt: "2026-10-24T00:00:01Z", args: {} }, now: "2026-10-24T00:00:01Z", params: {} });
  expect(output(status)).toMatchObject({ result: { callId, status: "succeeded", output: { echo: "once" } } });
});

test("delivery outcomes: never-delivered retries, lost after sending is unknown, restarts redeliver only idempotent calls", async () => {
  const seen: string[] = [];
  const f = await fixture({ alpha: async () => ({}), beta: async (event, _call, input) => {
    seen.push(event.trigger.id);
    // Dies after receiving the event: Chrona cannot know whether the tool acted.
    if (event.trigger.id === "crash") { f.processes.find(process => process.input === input)!.kill(); await new Promise(() => {}); }
    return { result: { ok: event.trigger.id } };
  } });
  const origin = kernelOrigin(f.workspace.id), find = (key: string) => f.db.moduleInvocation.findFirstOrThrow({ where: { key } });
  // Paused target: the call waits and is delivered once the target is back.
  await f.db.module.update({ where: { id: f.beta.id }, data: { status: "paused" } });
  await enqueueCall(f.db, f.ports, origin, "beta.echo", { text: "later" }, { key: "paused" });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await find("paused")).toMatchObject({ status: "queued", attempts: 1, error: expect.stringContaining("not active") });
  await f.db.module.update({ where: { id: f.beta.id }, data: { status: "active" } });
  f.advance(60_000); await runDueCalls(f.ports, f.workspace.id);
  expect(await find("paused")).toMatchObject({ status: "succeeded", attempts: 2 });

  await enqueueCall(f.db, f.ports, origin, "beta.crash", {}, { key: "crash" });
  await runDueCalls(f.ports, f.workspace.id);
  expect(await find("crash")).toMatchObject({ status: "unknown", error: expect.stringContaining("Outcome unknown") });

  // Chrona stopped mid-delivery (lease expired while running): only the idempotent call is sent again.
  for (const [target, key] of [["beta.echo", "interrupted"], ["beta.again", "interrupted-idempotent"]] as const) {
    const queued = await enqueueCall(f.db, f.ports, origin, target, {}, { key });
    await f.db.moduleInvocation.update({ where: { id: queued.callId }, data: { status: "running", attempts: 1, leaseToken: "old", leaseUntil: new Date(f.ports.now().getTime() - 1) } });
  }
  seen.length = 0;
  await runDueCalls(f.ports, f.workspace.id);
  expect(await find("interrupted")).toMatchObject({ status: "unknown", error: "Delivery interrupted; outcome unknown" });
  expect(await find("interrupted-idempotent")).toMatchObject({ status: "succeeded", attempts: 2 });
  expect(seen).toEqual(["again"]);
});

test("uses \"*\" reaches the tools open to the user, never modules-only tools it does not list or past callers", async () => {
  registerSystemModules();
  const f = await fixture({
    alpha: async (_event, call) => {
      const results: Record<string, unknown> = {};
      for (const target of ["beta.hidden", "beta.echo", "beta.private", "modules.tools"]) results[target] = await call("call", { target, args: target === "modules.tools" ? {} : { text: "x" } } as never);
      return { result: results };
    },
    beta: async event => ({ result: { tool: (event.trigger as { id: string }).id } }),
  });
  const alpha = moduleManifestSchema.parse({ name: "alpha", entry: "index.ts", tests: ["test.ts"], effects: [], triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }], uses: ["*", "modules.tools"], tools: [tool("pong")] });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.alpha.id, hash: "alpha-v1" } }, data: { manifest: alpha } });
  const results = output(await f.fire()) as Record<string, { result?: { output: unknown }; error?: { code: string } }>;
  expect(results["beta.hidden"]).toMatchObject({ result: { output: { tool: "hidden" } } });
  expect(results["beta.echo"]).toMatchObject({ error: { code: "forbidden" } });
  expect(results["beta.private"]).toMatchObject({ error: { code: "forbidden" } });
  // modules.tools lists exactly what the caller may reach.
  expect((results["modules.tools"]!.result!.output as { target: string }[]).map(entry => entry.target)).toEqual(["beta.hidden"]);
});

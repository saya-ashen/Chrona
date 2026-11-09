import { strict as assert } from "node:assert";
import { mock } from "bun:test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { ProviderAdapter, ProviderRunInput } from "@chrona/contracts/steward";
import { moduleAgentInput } from "./module-contracts";

type Trigger = { id: string; args: Record<string, unknown>; caller?: { kind: string; module?: string; moduleId?: string; hash?: string }; call?: { id: string } };
type Handler = (trigger: Trigger) => Promise<{ result: unknown }>;
const data = process.env.CHRONA_DATA!;
let handler!: Handler;
const calls: { target: string; args: Record<string, unknown> }[] = [];
const injected: string[] = [], completions: Record<string, unknown>[] = [], transcripts: { sessionDir: string; limit: number }[] = [];
let starts = 0, aborts = 0, finish!: (result: { outcome: "finished"; sessionId: null; error: null }) => void;
const view = { contextId: "context-one", runId: "run-one", status: "running", active: true };
let admit: (args: Record<string, unknown>) => unknown = () => { throw new Error("Unexpected admission"); };
const provider: ProviderAdapter = {
  name: "fixture", supportsRunModel: true,
  async health() { return { available: true, sandboxed: false, error: null }; },
  start(_input: ProviderRunInput) {
    starts++;
    return { done: new Promise(resolve => { finish = resolve; }), async inject(message) { injected.push(message); }, async abort() { aborts++; } };
  },
  async complete(args) { completions.push(args); return { text: "answer", inputTokens: 1, outputTokens: 1 }; },
  async transcript(args) { transcripts.push(args); return [{ at: "2026-11-08T00:00:00Z", kind: "text", text: "fixture transcript" }]; },
};
class ModelError extends Error { constructor(readonly code: string, message: string) { super(message); } }
mock.module("chrona", () => ({
  ModelError,
  chrona: { paths: { data }, async call(target: string, args: Record<string, unknown>) {
    calls.push({ target, args });
    if (target === "runtime-callback.agent-admit") return admit(args);
    if (target === "runtime-callback.agent-settle") return null;
    throw new Error(`Unexpected callback ${target}`);
  } },
  on(name: string, callback: Handler) { if (name === "tool") handler = callback; },
  onDisconnect() {},
}));
mock.module(join(import.meta.dir, "../../../../../../integrations/src/steward/pi-provider.ts"), () => ({ createPiProvider: () => provider }));
mock.module(join(import.meta.dir, "../../../../../../integrations/src/steward/browser.ts"), () => ({ createBrowsers: () => ({}) }));
const scenario = process.argv[2];
process.env.CHRONA_AGENT_CONFIGURATION = ["artifact-denial", "projects", "projects-artifact"].includes(scenario) ? "" : JSON.stringify({ backend: "pi", pi: {}, browser: {} });
if (["completion", "kernel"].includes(scenario)) await writeFile(join(data, "model-policy.json"), JSON.stringify({ tiers: { fast: { model: "budget/model", thinking: "high" } }, preferredTimeoutMs: 800 }));
if (["artifact-denial", "projects-artifact"].includes(scenario)) await import("./runtime.js");
else await import("./runtime");
const caller = { kind: "module", module: "consumer", moduleId: "consumer-id", hash: "version-one" };
async function moduleTool(id: string, args: Record<string, unknown> = {}, callId = `call-${id}`) { return (await handler({ id, args, caller, call: { id: callId } })).result; }
async function kernelTool(id: string, args: Record<string, unknown> = {}) { return (await handler({ id, args: { input: JSON.stringify(args) }, caller: { kind: "kernel" } })).result; }
const start = { operationId: "kernel-operation", runId: "kernel-run", token: "private-token", lane: "foreground", cwd: data, sessionDir: data, sessionId: null, prompt: "private-prompt", systemPrompt: "", resources: "minimal", deadline: new Date(Date.now() + 10000).toISOString() };
const operation = { operationId: start.operationId };
async function eventually(read: () => Promise<unknown>, ready: (value: unknown) => boolean) {
  for (let i = 0; i < 100; i++) { const value = await read(); if (ready(value)) return value; await Bun.sleep(5); }
  throw new Error("Fixture operation did not settle");
}

if (scenario === "denial" || scenario === "artifact-denial") {
  for (const name of ["start", "status", "inject", "abort", "release", "transcript"]) {
    for (const args of [{ ...start, "command-key": "legacy", message: "input" }, { input: JSON.stringify({ ...start, message: "input" }) }, {}]) {
      await assert.rejects(moduleTool(name, args), { code: "forbidden" }, `${name} must fail closed for modules`);
      assert.throws(() => moduleAgentInput(name, args), /forbidden/);
    }
  }
  await assert.rejects(moduleTool("unknown-tool"), { code: "forbidden" });
  for (const trigger of [
    { id: "health", args: {}, caller },
    { id: "health", args: {}, caller: { kind: "owner" }, call: { id: "owner" } },
    { id: "health", args: {} },
  ]) await assert.rejects(handler(trigger), { code: "forbidden" });
  assert.equal(starts, 0); assert.equal(aborts, 0); assert.deepEqual(injected, []);
  assert.deepEqual(completions, []); assert.deepEqual(transcripts, []); assert.deepEqual(calls, []);
}
if (scenario === "kernel") {
  assert.deepEqual(await kernelTool("start", start), operation);
  await kernelTool("start", start); assert.equal(starts, 1);
  assert.deepEqual(await kernelTool("inject", { ...operation, message: "follow-up" }), { accepted: true });
  assert.deepEqual(injected, ["follow-up"]);
  assert.deepEqual(await kernelTool("abort", operation), { requested: true }); assert.equal(aborts, 1);
  assert.deepEqual(await kernelTool("status", operation), { ...operation, outcome: null, failure: false });
  await assert.rejects(kernelTool("release", operation), { code: "conflict" });
  finish({ outcome: "finished", sessionId: null, error: null });
  await eventually(() => kernelTool("status", operation), value => !!(value as { outcome: unknown }).outcome);
  assert.deepEqual(await kernelTool("release", operation), { released: true });
  await kernelTool("start", start); assert.equal(starts, 1);
  assert.deepEqual(await kernelTool("transcript", { sessionDir: data, limit: 20 }), [{ at: "2026-11-08T00:00:00Z", kind: "text", text: "fixture transcript" }]);
  assert.deepEqual(transcripts, [{ sessionDir: data, limit: 20 }]);
  assert.equal((await kernelTool("health") as { available: boolean }).available, true);
  const completion = await kernelTool("complete", { model: "kernel/model", prompt: "fixture", maxOutputTokens: 20, timeoutMs: 1000 }) as { operationId: string };
  assert.deepEqual(await eventually(() => kernelTool("completion", completion), value => !!(value as { result: unknown }).result), { result: { text: "answer", inputTokens: 1, outputTokens: 1 }, failure: false });
  assert.equal(completions[0].model, "kernel/model");
  const tierCompletion = await kernelTool("complete", { declaredTier: "fast", effectiveHardLimits: { maxCallsPerEvent: 1, maxOutputTokens: 10, eventTimeoutMs: 500 }, prompt: "tier", maxOutputTokens: 20, timeoutMs: 1000 }) as { operationId: string };
  await eventually(() => kernelTool("completion", tierCompletion), value => !!(value as { result: unknown }).result);
  assert.deepEqual(completions[1], { prompt: "tier", system: undefined, model: "budget/model", thinking: "high", timeoutMs: 500, maxOutputTokens: 10 }); assert.deepEqual(calls, []);
}
if (scenario === "context") {
  await kernelTool("start", start);
  admit = args => {
    switch (args.operation) {
      case "context": return { contextId: view.contextId };
      case "run": case "get": return view;
      case "stream": return { items: [], after: 0, ended: false, interactions: [], transcript: { sessionDir: data, limit: 10 } };
      case "write": case "interrupt": return { perform: true, operationId: start.operationId, result: view };
      case "respond": return { accepted: true };
      default: throw new Error(`Unexpected context operation ${args.operation}`);
    }
  };
  assert.deepEqual(await moduleTool("context", { "request-key": "context-create" }), { contextId: view.contextId });
  assert.deepEqual(await moduleTool("run", { "context-id": view.contextId, "request-key": "run-create", prompt: "fixture" }), view);
  assert.deepEqual(await moduleTool("get", { "run-id": view.runId }), view);
  assert.deepEqual(await moduleTool("stream", { "run-id": view.runId }), { items: [], after: 0, ended: false, interactions: [], transcript: [{ at: "2026-11-08T00:00:00Z", kind: "text", text: "fixture transcript" }] });
  assert.deepEqual(transcripts, [{ sessionDir: data, limit: 10 }]);
  assert.deepEqual(await moduleTool("write", { "run-id": view.runId, "request-key": "write-once", text: "app input" }), { accepted: true });
  assert.deepEqual(injected, ["app input"]);
  assert.deepEqual(await moduleTool("interrupt", { "run-id": view.runId, "request-key": "interrupt-once" }), view); assert.equal(aborts, 1);
  assert.deepEqual(await moduleTool("respond", { "run-id": view.runId, "request-key": "respond-once", "question-id": "question-one", answer: "yes" }), { accepted: true });
  assert.deepEqual(calls.map(({ args }) => args), [
    { callId: "call-context", operation: "context" }, { callId: "call-run", operation: "run" }, { callId: "call-get", operation: "get" }, { callId: "call-stream", operation: "stream" },
    { callId: "call-write", operation: "write" }, { callId: "call-write", operation: "write", settle: true },
    { callId: "call-interrupt", operation: "interrupt" }, { callId: "call-interrupt", operation: "interrupt", settle: true }, { callId: "call-respond", operation: "respond" },
  ]);
  const admitted = calls.length;
  await assert.rejects(moduleTool("stream", { "run-id": view.runId, "session-dir": "/private" }), { code: "invalid" });
  assert.equal(calls.length, admitted);
  finish({ outcome: "finished", sessionId: null, error: null });
  await eventually(() => kernelTool("status", operation), value => !!(value as { outcome: unknown }).outcome);
}
if (scenario === "completion") {
  admit = () => ({ reservationId: "reservation-one", declaredTier: "fast", effectiveHardLimits: { maxCallsPerEvent: 2, maxOutputTokens: 20, eventTimeoutMs: 1000 } });
  assert.equal((await moduleTool("health") as { available: boolean }).available, true);
  const args = { "command-key": "complete-once", prompt: "fixture", "max-output-tokens": 20 };
  const started = await moduleTool("complete", args) as { operationId: string };
  assert.deepEqual(await eventually(() => moduleTool("completion", { "operation-id": started.operationId }), value => !!(value as { result: unknown }).result), { result: { text: "answer", inputTokens: 1, outputTokens: 1 }, failure: false });
  await eventually(async () => calls, value => (value as typeof calls).some(call => call.target === "runtime-callback.agent-settle"));
  assert.deepEqual(await moduleTool("complete", args), started);
  assert.equal(completions.length, 1); assert.equal(completions[0].model, "budget/model"); assert.equal(completions[0].thinking, "high"); assert.equal(completions[0].timeoutMs, 800); assert.equal(completions[0].maxOutputTokens, 20);
  assert.deepEqual(calls, [
    { target: "runtime-callback.agent-admit", args: { callId: "call-complete", operation: "complete" } },
    { target: "runtime-callback.agent-settle", args: { reservationId: "reservation-one", result: { text: "answer", inputTokens: 1, outputTokens: 1 }, failed: false } },
  ]);
  await assert.rejects(moduleTool("complete", { ...args, input: "{}" }), { code: "invalid" });
}

if (scenario === "configure") {
  const config = { tiers: { fast: { model: "owner/model", thinking: "high" } }, "preferred-timeout-ms": 700 };
  await assert.rejects(moduleTool("configure", { config }), { code: "unknown" });
  admit = args => { assert.equal(args.operation, "configure"); if (args.callId !== "owner-route") throw new ModelError("forbidden", "current owner visibility required"); return { authorized: true }; };
  await assert.rejects(moduleTool("configure", { config }), { code: "forbidden" });
  const result = (await handler({ id: "configure", args: { config }, caller: { kind: "owner" }, call: { id: "owner-route" } })).result;
  assert.deepEqual(result, { config: { tiers: config.tiers, preferredTimeoutMs: 700 }, ready: true });
  assert.equal((await moduleTool("health") as { complete: boolean }).complete, true);
  await assert.rejects(handler({ id: "configure", args: { config }, caller: { kind: "owner" } }), { code: "forbidden" });
}

if (["projects", "projects-artifact"].includes(scenario)) {
  const principal = { workspaceId: "workspace", ownerId: "owner", caller: { kind: "module", moduleId: caller.moduleId, hash: caller.hash } };
  const project = { projectRef: "opaque-ref", path: "/host/project", label: "project" };
  for (const request of [{ action: "list" }, { action: "register", path: project.path }, { action: "create", name: "project" }]) {
    const output = request.action === "list" ? { action: "list", principal, projects: [project] } : { action: request.action, principal, project };
    admit = args => { assert.deepEqual(args, { callId: "actual-call", operation: "projects" }); return output; };
    assert.deepEqual(await moduleTool("projects", request, "actual-call"), output);
  }
  const count = calls.length;
  for (const args of [{}, { action: "list", path: "/forged" }, { action: "register" }, { action: "create", name: "x", moduleId: "forged" }, { action: "list", input: "{}" }]) {
    await assert.rejects(moduleTool("projects", args), { code: "invalid" });
  }
  for (const trigger of [
    { id: "projects", args: { action: "list" }, caller },
    { id: "projects", args: { action: "list" }, caller: { kind: "owner" }, call: { id: "owner" } },
    { id: "projects", args: { action: "list" }, caller: { kind: "kernel" }, call: { id: "kernel" } },
  ]) await assert.rejects(handler(trigger), { code: "forbidden" });
  assert.equal(calls.length, count);
  admit = () => ({ action: "list", principal, projects: Array(101).fill(project) });
  await assert.rejects(moduleTool("projects", { action: "list" }), { code: "invalid" });
  admit = () => ({ action: "register", principal, project: { ...project, path: "x".repeat(8193) } });
  await assert.rejects(moduleTool("projects", { action: "register", path: project.path }), { code: "invalid" });
  admit = () => ({ action: "list", principal: { ...principal, caller: { kind: "owner" } }, projects: [] });
  await assert.rejects(moduleTool("projects", { action: "list" }), { code: "invalid" });
  admit = () => { throw new Error("unavailable: Host project management unavailable"); };
  await assert.rejects(moduleTool("projects", { action: "list" }), { code: "unavailable" });
  assert.equal(starts, 0); assert.deepEqual(completions, []);
}

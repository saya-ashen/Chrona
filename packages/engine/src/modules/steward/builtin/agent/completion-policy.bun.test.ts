import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createModelPolicy } from "./model-policy";
import { createModuleAgentOperations } from "./module-operations";
const caller = { kind: "module" as const, module: "consumer", moduleId: "consumer-id", hash: "current-hash" };
const request = { "command-key": "complete", prompt: "fixture", "max-output-tokens": 20 };
const limits = { maxCallsPerEvent: 1, maxOutputTokens: 10, eventTimeoutMs: 500 };
async function eventually(read: () => Promise<unknown>, ready: (value: unknown) => boolean) {
  for (let i = 0; i < 100; i++) { const value = await read(); if (ready(value)) return value; await Bun.sleep(5); }
  throw new Error("Completion did not settle");
}
test("Agent selects its own model and sends real output/time limits without clipping returned text", async () => {
  const data = await mkdtemp("/tmp/chrona-agent-completion-test-");
  const invoked: Record<string, unknown>[] = [], settlements: Record<string, unknown>[] = [];
  try {
    const policy = createModelPolicy(data, async () => ({ authorized: true }), async () => true);
    await policy.configure({ config: { tiers: { fast: { model: "fake/exact", thinking: "max" } }, preferredTimeoutMs: 1200 } }, "owner");
    const result = { text: "long-token-".repeat(40), inputTokens: 2, outputTokens: 5 };
    const operations = createModuleAgentOperations(data, async (target, args) => {
      if (target.endsWith("agent-admit")) return { reservationId: "durable-reservation", declaredTier: "fast", effectiveHardLimits: limits };
      settlements.push(args); return null;
    }, async args => { invoked.push(args); return result; }, policy);
    const started = await operations.handle("complete", request, caller, "live-call") as { operationId: string };
    const status = await eventually(() => operations.handle("completion", { "operation-id": started.operationId }, caller, "later-call"), value => !!(value as { result: unknown }).result);
    expect(status).toEqual({ result, failure: false });
    expect(invoked).toEqual([{ prompt: "fixture", system: undefined, model: "fake/exact", thinking: "max", maxOutputTokens: 10, timeoutMs: 500 }]);
    await eventually(async () => settlements, value => (value as unknown[]).length > 0);
    expect(settlements).toEqual([{ reservationId: "durable-reservation", result, failed: false }]);
  } finally { await rm(data, { recursive: true, force: true }); }
});
test("unknown provider execution never settles budget capacity or relaunches, including after restart", async () => {
  const data = await mkdtemp("/tmp/chrona-agent-unknown-test-");
  let settled = 0, launched = 0, admitted = 0;
  const policy = { async select() { return { model: "fake/exact", maxOutputTokens: 10, timeoutMs: 500 }; } };
  const call = async (target: string) => {
    if (target.endsWith("agent-admit")) { admitted++; return { reservationId: "pending", declaredTier: "fast", effectiveHardLimits: limits }; }
    settled++; return null;
  };
  const complete = async () => { launched++; throw Object.assign(new Error("uncertain execution"), { code: "unknown" }); };
  try {
    const operations = createModuleAgentOperations(data, call, complete, policy);
    const started = await operations.handle("complete", request, caller, "live") as { operationId: string };
    const args = { "operation-id": started.operationId };
    expect(await eventually(() => operations.handle("completion", args, caller, "poll"), value => !!(value as { unknown?: boolean }).unknown)).toEqual({ result: null, failure: false, unknown: true });
    const restarted = createModuleAgentOperations(data, call, complete, policy);
    expect(await restarted.handle("completion", args, caller, "after-expiry")).toEqual({ result: null, failure: false, unknown: true });
    await expect(restarted.handle("complete", request, caller, "replay")).rejects.toThrow("unknown");
    await expect(restarted.handle("completion", args, { ...caller, hash: "stale" }, "stale")).rejects.toThrow("forbidden");
    expect({ settled, launched, admitted }).toEqual({ settled: 0, launched: 1, admitted: 1 });
  } finally { await rm(data, { recursive: true, force: true }); }
});

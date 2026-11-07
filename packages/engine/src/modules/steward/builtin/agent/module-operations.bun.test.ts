import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createModuleAgentOperations } from "./module-operations";
const unusedControl = async () => { throw new Error("No execution in completion test"); };
const caller = { kind: "module" as const, module: "consumer", moduleId: "one", hash: "v1" };
const request = { "command-key": "model", prompt: "private", "max-output-tokens": 20 };

test("Agent model declarations use the ordinary manifest model budget contract", () => {
  const manifest = { name: "consumer", entry: "index.ts", triggers: [], keepAlive: true, effects: [], tests: ["test.ts"], uses: ["agent.complete"] };
  expect(moduleManifestSchema.safeParse(manifest).success).toBe(false);
  expect(moduleManifestSchema.safeParse({ ...manifest, model: { tier: "fast", maxCalls: 1, maxOutputTokens: 20 } }).success).toBe(true);
});

test("completion receipts survive restart, remain owned, and never repeat a paid request", async () => {
  const data = await mkdtemp("/tmp/chrona-agent-owned-"); let admissions = 0, starts = 0;
  const admit = async (target: string) => { if (target.endsWith("agent-admit")) { admissions++; return { reservationId: "reservation", model: "fake/model", timeoutMs: 5000 }; } return null; };
  const complete = async () => { starts++; return { text: "answer", inputTokens: 1, outputTokens: 1 }; };
  try {
    const operations = createModuleAgentOperations(data, admit, complete, unusedControl);
    const started = await operations.handle("complete", request, caller, "call") as { operationId: string };
    const args = { "operation-id": started.operationId };
    let result: unknown;
    for (let i = 0; i < 100; i++) { result = await operations.handle("completion", args, caller, "poll"); if ((result as { result: unknown }).result) break; await Bun.sleep(5); }
    expect(result).toMatchObject({ result: { text: "answer" }, failure: false });
    const restarted = createModuleAgentOperations(data, admit, complete, unusedControl);
    expect(await restarted.handle("complete", request, caller, "replay")).toEqual(started);
    expect(await restarted.handle("completion", args, caller, "poll")).toEqual(result);
    await expect(restarted.handle("completion", args, { ...caller, hash: "v2" }, "steal")).rejects.toThrow("forbidden");
    await expect(restarted.handle("complete", { ...request, prompt: "changed" }, caller, "replay")).rejects.toThrow("conflict");
    expect(admissions).toBe(1); expect(starts).toBe(1);
  } finally { await rm(data, { recursive: true, force: true }); }
});

test("an in-flight completion after Agent restart reports unknown and cannot be relaunched", async () => {
  const data = await mkdtemp("/tmp/chrona-agent-uncertain-"); let starts = 0;
  const admit = async () => ({ reservationId: "reservation", model: "fake/model", timeoutMs: 5000 });
  const complete = () => { starts++; return new Promise<never>(() => {}); };
  try {
    const first = createModuleAgentOperations(data, admit, complete, unusedControl);
    const started = await first.handle("complete", request, caller, "call") as { operationId: string };
    const restarted = createModuleAgentOperations(data, admit, complete, unusedControl);
    expect(await restarted.handle("completion", { "operation-id": started.operationId }, caller, "poll")).toEqual({ result: null, failure: true });
    await expect(restarted.handle("complete", request, caller, "replay")).rejects.toThrow("unknown");
    expect(starts).toBe(1);
  } finally { await rm(data, { recursive: true, force: true }); }
});

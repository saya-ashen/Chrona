import { strict as assert } from "node:assert";
import { createAgentOperations } from "./operations";
import { agentInput } from "./contracts";
import { createModuleAgentOperations } from "./module-operations";

await (async () => {
  let starts = 0, finish!: (value: { outcome: "finished"; sessionId: null; error: null }) => void;
  const data = process.env.CHRONA_DATA!;
  const operations = createAgentOperations({ name: "fixture", async health() { return { available: true, sandboxed: false, error: null }; }, start() {
    starts++;
    return { done: new Promise(resolve => { finish = resolve; }), async inject() {}, async abort() {} };
  } }, data, raw => ({ ...raw as object, deadline: new Date() }) as never);
  const input = { operationId: "author-test", runId: "author-test", token: "private-token", lane: "foreground", cwd: data, sessionDir: data, sessionId: null, prompt: "private-prompt", systemPrompt: "", resources: "minimal", deadline: new Date(Date.now() + 10000).toISOString() };
  agentInput("start", input);
  await operations.start(input); await operations.start(input);
  assert.equal(starts, 1, "Repeated start launches once");
  assert((await operations.control("abort", { operationId: input.operationId }) as { requested: boolean }).requested, "Cancel answers before backend stops");
  assert((await operations.control("status", { operationId: input.operationId }) as { outcome: unknown }).outcome === null, "Cancel is not stop evidence");
  finish({ outcome: "finished", sessionId: null, error: null });
  for (let i = 0; i < 100; i++) {
    if ((await operations.control("status", { operationId: input.operationId }) as { outcome: unknown }).outcome) break;
    await Bun.sleep(10);
  }
  await operations.control("release", { operationId: input.operationId });
  await operations.start(input);
  assert.equal(starts, 1, "Released receipts prevent replay");
  let modelCalls = 0;
  const moduleOperations = createModuleAgentOperations(data, async () => ({ reservationId: "author-reservation", declaredTier: "fast", effectiveHardLimits: { maxCallsPerEvent: 1, maxOutputTokens: 20, eventTimeoutMs: 1000 } }), async () => { modelCalls++; return { text: "answer", inputTokens: 1, outputTokens: 1 }; }, { async select() { return { model: "fake/model", timeoutMs: 1000, maxOutputTokens: 20 }; } });
  const caller = { kind: "module" as const, module: "author", moduleId: "author-module", hash: "author-version" };
  const params = { "command-key": "author-completion", prompt: "fixture", "max-output-tokens": 20 };
  const result = await moduleOperations.handle("complete", params, caller, "author-call") as { operationId: string };
  const ref = { "operation-id": result.operationId };
  for (let i = 0; i < 100; i++) {
    if ((await moduleOperations.handle("completion", ref, caller, "poll") as { result: unknown }).result) break;
    await Bun.sleep(10);
  }
  assert.deepEqual(await moduleOperations.handle("complete", params, caller, "replay"), result);
  assert.equal(modelCalls, 1);
  await assert.rejects(moduleOperations.handle("completion", ref, { ...caller, moduleId: "another" }, "steal"), /forbidden/);
})();

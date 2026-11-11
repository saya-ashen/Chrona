import { strict as assert } from "node:assert";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createPiOperations } from "./operations";
import { REGISTRATION } from "./application";
import type { ProviderRunInput } from "@chrona/contracts/steward";

// Shipped author test: fake providers only, no account, network or model required.
const data = await mkdtemp(join(process.env.CHRONA_DATA ?? "/tmp", "pi-module-test-"));
try {
  let starts = 0, nativeCalls = 0;
  let finish!: (value: { outcome: "finished"; sessionId: null; error: null }) => void;
  const operations = createPiOperations(data, async raw => ({
    provider: { name: "fake", async health() { return { available: true, sandboxed: false, error: null }; }, start() {
      starts++; return { done: new Promise(resolve => { finish = resolve; }), async inject() {}, async abort() {}, async native(request) { nativeCalls++; return { type: request.type, session: "same-handle" }; } };
    } }, input: { ...raw, deadline: null } as ProviderRunInput,
  }));
  const input = { operationId: "author-test", runId: "author-test", token: "private-token", callbacks: "00000000-0000-4000-8000-000000000001", lane: "foreground", cwd: data, sessionDir: data, sessionId: null, prompt: "private-prompt", systemPrompt: "", resources: "configured", deadline: null };
  await Promise.all([operations.start(input), operations.start(input)]);
  assert.equal(starts, 1);
  assert.deepEqual(await operations.control("native", { operationId: input.operationId, request: { type: "future-feature" } }), { response: { type: "future-feature", session: "same-handle" } });
  assert.equal(nativeCalls, 1); assert.equal(starts, 1);
  await operations.control("abort", { operationId: input.operationId });
  assert.equal((await operations.control("status", { operationId: input.operationId }) as { outcome: unknown }).outcome, null);
  finish({ outcome: "finished", sessionId: null, error: null });
  for (let count = 0; count < 200; count++) {
    if ((await operations.control("status", { operationId: input.operationId }) as { outcome: unknown }).outcome) break;
    await Bun.sleep(5);
  }
  await operations.control("release", { operationId: input.operationId });
  await operations.start(input); assert.equal(starts, 1);
  assert.equal(REGISTRATION.id, "pi"); assert.equal(REGISTRATION.endpoints.native, "native");
  let completeCalls = 0, closeCompletion!: () => void, aborted = false;
  const completions = createPiOperations(data, async () => { throw new Error("Unexpected conversation"); }, undefined, 64, async request => ({
    provider: { name: "fake-completion", async health() { return { available: true, sandboxed: false, error: null }; }, start() { throw new Error("Unexpected conversation"); }, async complete(input) {
      completeCalls++;
      const signal = (input as typeof input & { signal: AbortSignal }).signal;
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      await new Promise<void>(resolve => { closeCompletion = resolve; });
      throw Object.assign(new Error("Stopped"), { stopped: true });
    } }, input: { ...request, model: "fake/model" },
  }));
  const complete = { commandKey: "author-completion", prompt: "private", maxOutputTokens: 10, timeoutMs: 5000 };
  assert.deepEqual(await completions.complete(complete), { operationId: complete.commandKey });
  assert.equal((await completions.control("status", { operationId: complete.commandKey }) as { outcome: unknown }).outcome, null);
  await completions.control("abort", { operationId: complete.commandKey }); assert.equal(aborted, true);
  await assert.rejects(completions.control("release", { operationId: complete.commandKey }));
  await completions.complete(complete); assert.equal(completeCalls, 1); closeCompletion();
  for (let count = 0; count < 200; count++) {
    if ((await completions.control("status", { operationId: complete.commandKey }) as { outcome: unknown }).outcome) break;
    await Bun.sleep(5);
  }
  assert.equal((await completions.control("status", { operationId: complete.commandKey }) as { outcome: { outcome: string } }).outcome.outcome, "failed");
  await completions.control("release", { operationId: complete.commandKey });
} finally { await rm(data, { recursive: true, force: true }); }

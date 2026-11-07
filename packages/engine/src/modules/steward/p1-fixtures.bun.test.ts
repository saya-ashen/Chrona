import { expect, test } from "bun:test";
import { type ExecutionPrincipal, type ExecutionEvent, type ExecutionRef, type ExecutionStart, executionInputSchemas, executionRefSchema, editorResponseDataSchemas, codingToolDeclarations, parseCodingToolInput, executionToolContracts, moduleManifestSchema, type ProviderRunInput, MODULE_CALL_ERRORS, moduleCallReplySchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";
import { handleModuleCall } from "./module-effects";
import { resolveExecutionPrincipal } from "./execution-principal";
import { admitted, validateToolArgs, registerSystemModule, CallError, type Caller } from "./module-calls";
import { createFakeExecutionPorts, createFakeExecutionEventStore, createFakeP1Provider, projectP1ToolStart } from "./p1-fixtures";
const owner: ExecutionPrincipal = { workspaceId: "ws", ownerId: "owner", caller: { kind: "owner" } };
const moduleCaller: ExecutionPrincipal = { ...owner, caller: { kind: "module", moduleId: "coding", hash: "v1" } };
const ref: ExecutionRef = { workId: "w", sessionId: "s", runId: "r", attemptId: "a" };
const input = { workId: "w", projectRef: "p", commandKey: "k", goal: "fix", budget: { timeoutMs: 60_000, maxToolCalls: 10 } };
const projects = new Map([["p", { workspaceId: "ws", ownerId: "owner", moduleId: "coding", canonicalPath: "/tmp/authorized-test-project" }]]);
const event = (seq: number): ExecutionEvent => ({ ...ref, seq, at: "2026-11-05T00:00:00Z", payload: { type: "text_delta", messageId: "m", delta: "hi" } });
test("start receipt and enqueue are atomic, scoped, immutable and recoverable by original key", async () => {
  let fail = true;
  const fake = createFakeExecutionPorts({ projects, beforeCommit() { if (fail) throw new Error("transaction failed"); } });
  await expect(fake.ports.start(moduleCaller, input)).rejects.toThrow("transaction failed");
  expect(fake.enqueued).toHaveLength(0); fail = false;
  const first = await fake.ports.start(moduleCaller, input);
  expect(await fake.ports.start(moduleCaller, input)).toEqual(first); expect(fake.enqueued).toHaveLength(1);
  await expect(fake.ports.start(moduleCaller, { ...input, goal: "different" })).rejects.toMatchObject({ code: "conflict" });
  await expect(fake.ports.start({ ...moduleCaller, workspaceId: "other" }, { ...input, workId: "other" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(fake.ports.start({ ...moduleCaller, caller: { kind: "module", moduleId: "attacker", hash: "v1" } }, { ...input, workId: "other" })).rejects.toMatchObject({ code: "forbidden" });
  expect(await fake.ports.get(owner, "w")).toEqual(first);
  expect(await fake.ports.lookupStart(moduleCaller, "k")).toEqual(first);
  expect(await fake.ports.lookupStart(owner, "k")).toEqual(first);
  expect((await fake.ports.list(moduleCaller, { limit: 1 })).works).toEqual([first]);
  expect((await fake.ports.list({ ...owner, ownerId: "other" }, { limit: 1 })).works).toEqual([]);
  await expect(fake.ports.get({ ...owner, ownerId: "stranger" }, "w")).rejects.toMatchObject({ code: "forbidden" });
  fake.detach(); expect((await fake.ports.get(owner, "w")).status).toBe("queued");
});
for (const status of ["queued", "running", "completed", "unknown"] as const) test(`cancel preserves process evidence: ${status}`, async () => {
  const fake = createFakeExecutionPorts({ projects }), view = await fake.ports.start(owner, input);
  if (status !== "queued") fake.settle(owner, "w", status, status === "completed");
  const command = { op: "cancel" as const, ...view, commandKey: "cancel" };
  const cancelled = await fake.ports.cancel(owner, command);
  expect(cancelled.cancelRequested).toBe(true); expect(cancelled.stopConfirmed).toBe(status === "queued" || status === "completed");
  expect(cancelled.status).toBe(status === "queued" ? "cancelled" : status);
  expect(await fake.ports.cancel(owner, command)).toEqual(cancelled);
  await expect(fake.ports.cancel(owner, { ...command, attemptId: "old" })).rejects.toMatchObject({ code: "conflict" });
});
test("answers are exactly-once while valid; restart and expiry never replay old authorization", async () => {
  const fake = createFakeExecutionPorts({ projects, now: () => 100 }), view = await fake.ports.start(owner, input);
  const answer = { op: "answer" as const, ...view, commandKey: "answer", requestId: "q", answer: { decision: "submit" as const, value: 0 } };
  fake.question("q", view, 101);
  await fake.ports.answer(owner, answer); await fake.ports.answer(owner, answer);
  await expect(fake.ports.answer(owner, { ...answer, commandKey: "other" })).rejects.toMatchObject({ code: "conflict" });
  fake.question("expired", view, 99);
  await expect(fake.ports.answer(owner, { ...answer, requestId: "expired", commandKey: "expired" })).rejects.toMatchObject({ code: "conflict" });
  fake.question("restart", view, 101); fake.restart();
  await expect(fake.ports.answer(owner, { ...answer, requestId: "restart", commandKey: "restart" })).rejects.toMatchObject({ code: "conflict" });
});
test("event identity, duplicate content, gaps, cursor owner/work/attempt binding", async () => {
  const fake = createFakeExecutionEventStore(); fake.reserve(moduleCaller, ref);
  await fake.store.append(moduleCaller, event(1)); await fake.store.append(moduleCaller, event(1));
  await expect(fake.store.append(moduleCaller, { ...event(1), payload: { type: "text_delta", messageId: "m", delta: "changed" } })).rejects.toMatchObject({ code: "conflict" });
  const first = await fake.store.read(moduleCaller, { ...ref, limit: 1, waitMs: 0 }); expect(first.events).toHaveLength(1);
  await fake.store.append(moduleCaller, event(3));
  expect((await fake.store.read(moduleCaller, { ...ref, cursor: first.cursor, limit: 1, waitMs: 0 })).gap).toBe(true);
  await expect(fake.store.append(moduleCaller, event(2))).rejects.toMatchObject({ code: "conflict" });
  await expect(fake.store.read(owner, { ...ref, cursor: first.cursor, limit: 1, waitMs: 0 })).rejects.toMatchObject({ code: "forbidden" });
  await expect(fake.store.snapshot({ ...owner, ownerId: "other" }, ref)).rejects.toMatchObject({ code: "forbidden" });
  fake.reserve(moduleCaller, { ...ref, workId: "w2", attemptId: "a2" });
  await expect(fake.store.read(moduleCaller, { ...ref, workId: "w2", attemptId: "a2", cursor: first.cursor, limit: 1, waitMs: 0 })).rejects.toMatchObject({ code: "forbidden" });
});
test("bounded pages and admission: active headroom is finite; small retained snapshots do not block the 65th", async () => {
  const fake = createFakeExecutionEventStore();
  for (let i = 0; i < 64; i++) fake.reserve(owner, { ...ref, workId: `w-${i}`, attemptId: `a-${i}` });
  expect(() => fake.reserve(owner, ref)).toThrow("capacity");
  for (let i = 0; i < 64; i++) {
    const next = { ...ref, workId: `w-${i}`, attemptId: `a-${i}` };
    const saved = await fake.store.snapshot(owner, next);
    fake.saveSnapshot(owner, { ...saved, status: "completed", finalMessage: { messageId: "m", text: "done", truncated: false } });
  }
  fake.reserve(owner, ref);
  for (let seq = 1; seq <= 3; seq++) await fake.store.append(owner, event(seq));
  expect((await fake.store.read(owner, { ...ref, limit: 1, waitMs: 0 })).events).toEqual([event(1)]);
  const snapshot = await fake.store.snapshot(owner, ref);
  fake.saveSnapshot(owner, { ...snapshot, status: "completed", finalMessage: { messageId: "m", text: "done", truncated: false } });
  fake.reserve(owner, { ...ref, workId: "next", attemptId: "next" });
  expect((await fake.store.snapshot(owner, ref)).finalMessage?.text).toBe("done");
});
test("owner poll cap and abort release without cancellation", async () => {
  const fake = createFakeExecutionEventStore(); fake.reserve(owner, ref);
  const aborts = Array.from({ length: 4 }, () => new AbortController());
  const polls = aborts.map(controller => fake.store.read(owner, { ...ref, limit: 1, waitMs: 15_000, signal: controller.signal }));
  expect(fake.stats().waiters).toBe(4);
  await expect(fake.store.read(owner, { ...ref, limit: 1, waitMs: 1 })).rejects.toMatchObject({ code: "capacity" });
  for (const controller of aborts) controller.abort(); await Promise.all(polls); expect(fake.stats().waiters).toBe(0);
  expect((await fake.store.snapshot(owner, ref)).cancelRequested).toBe(false);
});
test("fake Provider has explicit lifecycle with independent project/log inputs and no model", async () => {
  const fake = createFakeP1Provider();
  const handle = fake.provider.start({ runId: "r", token: "fixture-only", lane: "background", cwd: "/tmp/project", sessionDir: "/tmp/logs", sessionId: null, systemPrompt: "Fixture instructions", resources: "minimal", prompt: "goal", deadline: new Date() });
  await handle.inject("follow-up"); expect(fake.injections).toEqual(["follow-up"]);
  expect(fake.starts[0]?.cwd).not.toBe(fake.starts[0]?.sessionDir);
  fake.settle("r"); expect((await handle.done).outcome).toBe("finished");
  expect(fake.aborted()).toBe(0);
});
test("tool projection whitelists before redaction and never exports arbitrary tool payloads", () => {
  const projected = projectP1ToolStart("read", "call", { path: "/tmp/credential", token: "credential", raw: "credential", env: { KEY: "credential" }, thinking: "credential" }, value => value.replaceAll("credential", "[REDACTED]"));
  expect(projected).toEqual({ type: "tool_started", toolCallId: "call", tool: "read", display: { path: "/tmp/[REDACTED]" } });
  expect(projectP1ToolStart("unknown", "call", { path: "/secret" }, value => value)).toMatchObject({ display: {} });
});

test("P1 consumer smoke: routed identity, manifest JSON input, bound Provider sink and F-owned G transaction", async () => {
  const db = testDb(), provider = createFakeP1Provider(), events = createFakeExecutionEventStore();
  const txCalls: unknown[] = [];
  const ports: StewardPorts = {
    db, now: () => new Date(), dataDir: "/tmp/p1-consumer-unused", publicUrl: null, provider: provider.provider,
    executions: createFakeExecutionPorts({ projects }).ports,
    resolveExecutionProject: async (_p, projectRef) => ({ projectRef, executor: "server", canonicalPath: "/tmp/authorized-test-project", baseline: "fixture" }),
    executionEvents: { ...events.store,
      async admit(tx, p, target) { txCalls.push(tx); events.reserve(p, target); },
      async control(tx) { txCalls.push(tx); },
      async saveSnapshot(tx, p, snapshot) { txCalls.push(tx); events.saveSnapshot(p, snapshot); },
    },
  };
  try {
    const workspace = await db.workspace.create({ data: { name: "p1-consumer" } });
    const callers: Caller[] = [];
    for (const [name, uses] of [["coding", ["executions.start"]], ["editor", []], ["owner-entry", ["*"]]] as const) {
      const manifest = moduleManifestSchema.parse({ name, uses, entry: "index.ts", tests: ["test.ts"], keepAlive: true, triggers: [], effects: [], tools: name === "coding" ? codingToolDeclarations() : [] });
      if (name === "coding") expect(validateToolArgs(manifest.tools[0]!, { input: JSON.stringify(input) })).toEqual({ input: JSON.stringify(input) });
      const row = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: "v1", status: "active" } });
      await db.moduleVersion.create({ data: { moduleId: row.id, hash: "v1", manifest, status: "approved", source: "user", intent: {}, report: {} } });
      callers.push({ kind: "module", module: name, moduleId: row.id, hash: "v1" });
    }
    const [coding, namedEditor, entry] = callers;
    registerSystemModule({ name: "p1-error-probe", description: "Test-only error consumer", tools: [{ ...executionToolContracts[0]!, name: "probe" }],
      async handle(_context, _tool, args) { throw new CallError(args.goal as (typeof MODULE_CALL_ERRORS)[number], "bounded fixture error"); },
    });
    const manifest = moduleManifestSchema.parse({ name: "coding", uses: ["executions.start"], entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [], tools: codingToolDeclarations() });
    for (const code of ["invalid", "forbidden", "conflict", "unavailable", "capacity", "cursor_expired", "too_large", "unsupported_version"] as const) {
      const reply = await handleModuleCall(ports, { workspaceId: workspace.id, moduleId: (coding as Extract<Caller, { kind: "module" }>).moduleId, hash: "v1", manifest }, { id: "error-smoke", method: "call", params: { target: "p1-error-probe.probe", mode: "sync", reply: false, args: { ...input, goal: code } } });
      expect(moduleCallReplySchema.parse(reply)).toMatchObject({ error: { code } });
    }
    const codingPrincipal = await resolveExecutionPrincipal(ports, workspace.id, coding!);
    expect(codingPrincipal.caller).toMatchObject({ kind: "module", moduleId: (coding as Extract<Caller, { kind: "module" }>).moduleId });
    expect((await resolveExecutionPrincipal(ports, workspace.id, namedEditor!)).caller.kind).toBe("module");
    expect(await admitted(db, entry!, { ...executionToolContracts[0]!, visibility: ["owner"] })).toBe(true);
    const principal = await resolveExecutionPrincipal(ports, workspace.id, entry!);
    expect(principal.caller.kind).toBe("owner");
    expect(await admitted(db, namedEditor!, { ...executionToolContracts[0]!, visibility: ["owner"] })).toBe(false);
    const decoded: ExecutionStart = parseCodingToolInput("create", JSON.stringify(input));
    expect(decoded).toEqual(executionInputSchemas.start.parse(input));
    await db.$transaction(async tx => {
      await ports.executionEvents!.admit(tx, principal, ref);
      await ports.executionEvents!.control(tx, principal, ref, { slot: "admission", status: "confirmed", at: ports.now().toISOString() });
      const snapshot = await ports.executionEvents!.snapshot(principal, ref);
      await ports.executionEvents!.saveSnapshot(tx, principal, { ...snapshot, status: "completed" });
      expect(txCalls.every(value => value === tx)).toBe(true);
    });
    const project = await ports.resolveExecutionProject!(codingPrincipal, "p");
    const run: ProviderRunInput = { runId: ref.runId, token: "fixture-only", lane: "background", cwd: project.canonicalPath, sessionDir: "/tmp/independent-log", sessionId: null, systemPrompt: "Fixture instructions", resources: "minimal", prompt: "goal", deadline: new Date(), execution: ref, detail: { append: value => ports.executionEvents!.append(principal, value) } };
    const handle = ports.provider!.start(run);
    await run.detail!.append(event(1)); provider.settle(ref.runId); await handle.done;
    const view = { ...ref, projectRef: "p", status: "completed", cancelRequested: false, stopConfirmed: true };
    const attached = editorResponseDataSchemas.attach.parse(view), target = executionRefSchema.parse({ workId: attached.workId, sessionId: attached.sessionId, runId: attached.runId, attemptId: attached.attemptId });
    const page = await ports.executionEvents!.read(principal, { ...target, limit: 1, waitMs: 0 });
    expect(editorResponseDataSchemas.events.parse(page).events).toHaveLength(1);
    expect((await ports.executionEvents!.read(principal, { ...target, cursor: page.cursor, limit: 1, waitMs: 0 })).events).toEqual([]);
    expect(editorResponseDataSchemas.snapshot.parse(await ports.executionEvents!.snapshot(principal, target)).status).toBe("completed");
    expect(editorResponseDataSchemas.results.parse({ results: [] })).toEqual({ results: [] });
    expect(editorResponseDataSchemas.accept.parse({ accepted: true })).toEqual({ accepted: true });
  } finally { await db.$disconnect(); }
});

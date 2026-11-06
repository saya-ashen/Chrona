import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionPrincipal, ExecutionStart } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { createExecutions } from "./execution";
import { executionView } from "./execution-state";
import { createRuns, liveRuns } from "./runs";
import { CallError } from "./module-calls";
import { createProviderChannel } from "./provider-channel";

let db: ReturnType<typeof testDb>, ports: StewardPorts, principal: ExecutionPrincipal, owner: ExecutionPrincipal;
const input: ExecutionStart = { workId: "work", projectRef: "project", commandKey: "start", goal: "Fix fixture", budget: { timeoutMs: 60_000, maxToolCalls: 5 } };
beforeEach(async () => {
  db = testDb();
  const workspace = await db.workspace.create({ data: { name: "execution-test" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "coding", activeHash: "hash", status: "active" } });
  principal = { workspaceId: workspace.id, ownerId: "owner", caller: { kind: "module", moduleId: module.id, hash: "hash" } };
  owner = { ...principal, caller: { kind: "owner" } };
  const project = await mkdtemp(join(tmpdir(), "chrona-execution-project-"));
  ports = { db, now: () => new Date("2026-11-05T12:00:00Z"), dataDir: await mkdtemp(join(tmpdir(), "chrona-execution-data-")), publicUrl: null,
    resolveExecutionProject: async (_, projectRef) => ({ projectRef, executor: "server", canonicalPath: project, baseline: "commit:fixture" }),
    executionEvents: { admit: mock(async () => {}), control: mock(async () => {}), saveSnapshot: mock(async () => {}), append: mock(async () => {}), read: mock(async () => { throw new Error("unused"); }), snapshot: mock(async () => { throw new Error("unused"); }) } };
});
afterEach(async () => { liveRuns.clear(); await db.$disconnect(); });

test.each([
  { runStatus: "queued", cancelled: false, revoked: false, stopped: false, status: "queued" },
  { runStatus: "running", cancelled: false, revoked: false, stopped: false, status: "running" },
  { runStatus: "running", cancelled: true, revoked: true, stopped: false, status: "unknown" },
  { runStatus: "failed", cancelled: true, revoked: true, stopped: false, status: "unknown" },
  { runStatus: "finished", cancelled: false, revoked: true, stopped: true, status: "completed" },
  { runStatus: "cancelled", cancelled: true, revoked: true, stopped: true, status: "cancelled" },
  { runStatus: "timed_out", cancelled: false, revoked: true, stopped: true, status: "failed" },
])("Run $runStatus / stop=$stopped maps to $status with independent cancel intent", async item => {
  const ref = await createExecutions(ports).start(principal, input);
  const now = ports.now();
  await db.run.update({ where: { id: ref.runId }, data: { status: item.runStatus } });
  const row = await db.executionAttempt.update({ where: { id: ref.attemptId }, data: { cancelRequestedAt: item.cancelled ? now : null, capabilityRevokedAt: item.revoked ? now : null, stopConfirmedAt: item.stopped ? now : null }, include: { run: true } });
  expect(executionView(row)).toMatchObject({ status: item.status, cancelRequested: item.cancelled, stopConfirmed: item.stopped });
});
test("same start key returns original session/run and conflicting digest rolls back", async () => {
  const service = createExecutions(ports), first = await service.start(principal, input);
  expect(await service.start(principal, input)).toEqual(first);
  expect(await service.start(principal, { budget: { maxToolCalls: 5, timeoutMs: 60_000 }, goal: input.goal, commandKey: input.commandKey, projectRef: input.projectRef, workId: input.workId })).toEqual(first);
  await expect(service.start(principal, { ...input, goal: "different" })).rejects.toMatchObject({ code: "conflict" });
  expect(await db.run.count()).toBe(1); expect(await db.session.count()).toBe(1);
  expect(await service.resultSource(principal, first)).toEqual({ workId: first.workId, sessionId: first.sessionId, runId: first.runId, attemptId: first.attemptId, baseline: { kind: "commit", digest: "fixture" } });
  await expect(service.resultSource(principal, { ...first, attemptId: "other" })).rejects.toMatchObject({ code: "not_found" });
  expect(ports.executionEvents!.admit).toHaveBeenCalledTimes(1);
  const args = (ports.executionEvents!.admit as ReturnType<typeof mock>).mock.calls[0]!;
  expect(args[0]).toHaveProperty("executionAttempt");
  expect(args[2]).toMatchObject({ attemptId: first.attemptId, runId: first.runId });
});
test("host project mapping rejects noncanonical symlink paths without creating rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-symlink-project-"));
  const real = (await ports.resolveExecutionProject!(principal, input.projectRef)).canonicalPath;
  await symlink(real, join(root, "linked"));
  ports.resolveExecutionProject = async (_, projectRef) => ({ projectRef, executor: "server", canonicalPath: join(root, "linked"), baseline: "commit:fixture" });
  await expect(createExecutions(ports).start(principal, input)).rejects.toMatchObject({ code: "forbidden" });
  expect(await db.run.count()).toBe(0); expect(await db.executionAttempt.count()).toBe(0);
});
test("G admission rejection rolls back Run, session, attempt and directory reservation", async () => {
  ports.executionEvents!.admit = async tx => { expect(await tx.executionAttempt.count()).toBe(1); throw new CallError("capacity", "Fixture full"); };
  await expect(createExecutions(ports).start(principal, input)).rejects.toMatchObject({ code: "capacity" });
  expect(await db.run.count()).toBe(0); expect(await db.session.count()).toBe(0); expect(await db.executionAttempt.count()).toBe(0);
});
test("directory is globally exclusive and owner reads are scoped without arbitrary first match", async () => {
  const service = createExecutions(ports), first = await service.start(principal, input);
  await expect(service.start(owner, { ...input, workId: "other", commandKey: "other" })).rejects.toMatchObject({ code: "conflict" });
  expect(await service.get(owner, input.workId)).toEqual(first);
  await expect(service.get({ ...owner, ownerId: "another" }, input.workId)).rejects.toMatchObject({ code: "not_found" });
  const project = await mkdtemp(join(tmpdir(), "chrona-execution-other-"));
  ports.resolveExecutionProject = async (_, projectRef) => ({ projectRef, executor: "server", canonicalPath: project, baseline: "snapshot:fixture" });
  await service.start(owner, input);
  await expect(service.get(owner, input.workId)).rejects.toMatchObject({ code: "conflict" });
  await expect(service.lookupStart(owner, input.commandKey)).rejects.toMatchObject({ code: "conflict" });
  expect((await service.list(principal, { limit: 10 })).works).toHaveLength(1);
});
test("queued cancel atomically proves never started; replay is safe; terminal cancel preserves outcome", async () => {
  const service = createExecutions(ports), ref = await service.start(principal, input);
  const command = { ...ref, op: "cancel" as const, commandKey: "cancel" };
  const cancelled = await service.cancel(principal, command);
  expect(cancelled).toMatchObject({ status: "cancelled", cancelRequested: true, stopConfirmed: true });
  expect(await service.cancel(principal, command)).toEqual(cancelled);
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: ref.attemptId } })).heldDirectory).toBeNull();
  expect(await db.executionCommand.count()).toBe(1);
  expect(ports.executionEvents!.saveSnapshot).toHaveBeenCalledTimes(1);
});
test("cancel revokes capability before abort, failed stop retains directory, later actual exit releases atomically", async () => {
  const service = createExecutions(ports), ref = await service.start(principal, input), runs = createRuns(ports, principal.workspaceId);
  const run = (await runs.claimNext("background"))!;
  expect(run.deadlineAt.getTime() - ports.now().getTime()).toBe(input.budget.timeoutMs);
  liveRuns.set(run.id, { inject: async () => {}, done: new Promise(() => {}), abort: async () => {
    expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: ref.attemptId } })).capabilityRevokedAt).not.toBeNull();
    await expect(runs.authenticate(run.token)).rejects.toMatchObject({ code: "forbidden" });
    throw new Error("Stop unknown");
  } });
  await expect(service.cancel(principal, { ...ref, op: "cancel", commandKey: "cancel" })).rejects.toThrow("Stop unknown");
  await runs.finish(run.id, { outcome: "failed", sessionId: null, error: "Unknown" });
  expect(await service.get(principal, input.workId)).toMatchObject({ status: "unknown", cancelRequested: true, stopConfirmed: false });
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: ref.attemptId } })).heldDirectory).not.toBeNull();
  expect(await db.run.count()).toBe(1);
  await runs.finish(run.id, { outcome: "failed", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
  expect(await service.get(principal, input.workId)).toMatchObject({ status: "cancelled", stopConfirmed: true });
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: ref.attemptId } })).heldDirectory).toBeNull();
});
test("finish first then cancel keeps completed terminal outcome; lease expiry alone stays unknown", async () => {
  const service = createExecutions(ports), ref = await service.start(principal, input), runs = createRuns(ports, principal.workspaceId);
  await runs.claimNext("background");
  await runs.finish(ref.runId, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" });
  expect(await service.cancel(principal, { ...ref, op: "cancel", commandKey: "late-cancel" })).toMatchObject({ status: "completed", cancelRequested: false, stopConfirmed: true });
  const next = await service.start(principal, { ...input, workId: "next", commandKey: "next" });
  await runs.claimNext("background");
  await runs.expireLeases(new Date(ports.now().getTime() + 120_000));
  expect(await service.get(principal, next.workId)).toMatchObject({ status: "unknown", stopConfirmed: false });
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: next.attemptId } })).heldDirectory).not.toBeNull();
  expect(await db.run.count()).toBe(2);
});
test("control storage rejection rolls back cancellation receipt and revocation before abort", async () => {
  const service = createExecutions(ports), ref = await service.start(principal, input);
  await createRuns(ports, principal.workspaceId).claimNext("background");
  const abort = mock(async () => {});
  liveRuns.set(ref.runId, { inject: async () => {}, abort, done: new Promise(() => {}) });
  ports.executionEvents!.control = async () => { throw new Error("control disk failed"); };
  await expect(service.cancel(principal, { ...ref, op: "cancel", commandKey: "cancel" })).rejects.toThrow("control disk failed");
  const row = await db.executionAttempt.findUniqueOrThrow({ where: { id: ref.attemptId } });
  expect(row.capabilityRevokedAt).toBeNull(); expect(row.cancelRequestedAt).toBeNull(); expect(await db.executionCommand.count()).toBe(0);
  expect(abort).not.toHaveBeenCalled();
});
test("snapshot failure rolls back finish and retains directory; never_started cannot authorize a claimed run", async () => {
  const service = createExecutions(ports), ref = await service.start(principal, input), runs = createRuns(ports, principal.workspaceId);
  await runs.claimNext("background");
  ports.executionEvents!.saveSnapshot = async () => { throw new Error("disk failed"); };
  await expect(runs.finish(ref.runId, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "provider_exited" })).rejects.toThrow("disk failed");
  expect((await db.run.findUniqueOrThrow({ where: { id: ref.runId } })).status).toBe("running");
  expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: ref.attemptId } })).stopConfirmedAt).toBeNull();
  await expect(runs.finish(ref.runId, { outcome: "finished", sessionId: null, error: null }, { stopEvidence: "never_started" })).rejects.toMatchObject({ code: "conflict" });
});
test("send receipt never causes automatic resend after unknown injection, conflicting reused key rejects", async () => {
  const service = createExecutions(ports), ref = await service.start(principal, input);
  await createRuns(ports, principal.workspaceId).claimNext("background");
  const inject = mock(async () => { throw new Error("Unknown external effect"); });
  liveRuns.set(ref.runId, { inject, abort: async () => {}, done: new Promise(() => {}) });
  const command = { ...ref, op: "send" as const, commandKey: "send", text: "continue" };
  await expect(service.send(principal, command)).rejects.toThrow("Unknown external effect");
  await service.send(principal, command);
  expect(inject).toHaveBeenCalledTimes(1);
  await expect(service.send(principal, { ...command, text: "changed" })).rejects.toMatchObject({ code: "conflict" });
  expect(JSON.stringify(await db.executionCommand.findMany())).not.toContain("continue");
});
test("same immutable module at a new hash cannot read/control original-hash attempts or recover their start key", async () => {
  const service = createExecutions(ports), ref = await service.start(principal, input);
  if (principal.caller.kind !== "module") throw new Error("Fixture module missing");
  await db.module.update({ where: { id: principal.caller.moduleId }, data: { activeHash: "next-hash" } });
  const updated: ExecutionPrincipal = { ...principal, caller: { ...principal.caller, hash: "next-hash" } };
  await expect(service.get(updated, input.workId)).rejects.toMatchObject({ code: "not_found" });
  await expect(service.lookupStart(updated, input.commandKey)).rejects.toMatchObject({ code: "not_found" });
  expect((await service.list(updated, { limit: 10 })).works).toEqual([]);
  await expect(service.start(updated, input)).rejects.toMatchObject({ code: "conflict" });
  await expect(service.cancel(updated, { ...ref, op: "cancel", commandKey: "cancel" })).rejects.toMatchObject({ code: "not_found" });
  expect(await service.get(owner, input.workId)).toEqual(ref);
});
test("inactive immutable caller cannot start, read or launch", async () => {
  const service = createExecutions(ports);
  await db.module.update({ where: { id: principal.caller.kind === "module" ? principal.caller.moduleId : "" }, data: { activeHash: "replacement" } });
  await expect(service.start(principal, input)).rejects.toMatchObject({ code: "forbidden" });
  expect(await db.run.count()).toBe(0);
});
test.each([{ method: "select" as const, value: 0, options: ["first", "second"] }, { method: "confirm" as const, value: false, options: [] }])("answer $method uses live Provider rules and rejects stale/cross-run requests", async ({ method, value, options }) => {
  const service = createExecutions(ports), ref = await service.start(principal, input), runs = createRuns(ports, principal.workspaceId);
  const run = (await runs.claimNext("background"))!;
  liveRuns.set(run.id, { inject: async () => {}, abort: async () => {}, done: new Promise(() => {}) });
  const channel = createProviderChannel(ports, run), abort = new AbortController();
  const waiting = channel.events.question({ method, title: "Fixture question", message: "choose", options: [...options], timeoutMs: 30_000 }, abort.signal);
  let requestId = "";
  for (let i = 0; i < 50; i++) {
    const question = await db.audit.findFirst({ where: { kind: "provider_question", subjectId: run.id } });
    if (question) { requestId = (question.details as { id: string }).id; break; }
    await Bun.sleep(5);
  }
  expect(requestId).not.toBe("");
  const command = { ...ref, op: "answer" as const, commandKey: "answer", requestId, answer: { decision: "submit" as const, value } };
  await expect(service.answer(principal, { ...command, runId: "other" })).rejects.toMatchObject({ code: "not_found" });
  if (method === "select") await expect(service.answer(principal, { ...command, answer: { decision: "submit", value: 2 } })).rejects.toMatchObject({ code: "invalid" });
  await service.answer(principal, command);
  expect(await waiting).toEqual(command.answer);
  await expect(service.answer(principal, { ...command, commandKey: "stale" })).rejects.toMatchObject({ code: "conflict" });
  await channel.close();
});

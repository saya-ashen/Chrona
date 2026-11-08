import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutionPrincipal, ExecutionStart, ExecutionView } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { createExecutions } from "./execution";
import { createExecutionEventStore } from "./execution-event-store";
import { createRuns, liveRuns } from "./runs";

let db: ReturnType<typeof testDb>, ports: StewardPorts, principal: ExecutionPrincipal, root: string, project: string;
const firstInput: ExecutionStart = { workId: "turn-1", projectRef: "project", commandKey: "start-1", goal: "First round", budget: { timeoutMs: 60_000, maxToolCalls: 5 } };
const sourceRef = (source: ExecutionView) => ({ workId: source.workId, runId: source.runId, attemptId: source.attemptId });
const continuation = (source: ExecutionView): ExecutionStart => ({ ...firstInput, workId: "turn-2", commandKey: "start-2", goal: "Second round", resumeFrom: sourceRef(source) });
beforeEach(async () => {
  db = testDb();
  root = await mkdtemp(join(tmpdir(), "chrona-execution-continuation-"));
  project = join(root, "project");
  await mkdir(project);
  const workspaceId = (await db.workspace.create({ data: { name: "continuation-test" } })).id;
  const module = await db.module.create({ data: { workspaceId, name: "coding", activeHash: "hash", status: "active" } });
  principal = { workspaceId, ownerId: "owner", caller: { kind: "module", moduleId: module.id, hash: "hash" } };
  ports = { db, now: () => new Date("2026-11-05T12:00:00Z"), dataDir: join(root, "data"), publicUrl: null,
    resolveExecutionProject: async (_, projectRef) => ({ projectRef, executor: "server", canonicalPath: project, baseline: "commit:fixture" }),
    onQueued: mock(async () => {}) };
  ports.executionEvents = createExecutionEventStore(ports);
});
afterEach(async () => { liveRuns.clear(); await db.$disconnect(); await rm(root, { recursive: true, force: true }); });

async function stoppedSource(who = principal) {
  const service = createExecutions(ports), source = await service.start(who, firstInput), runs = createRuns(ports, who.workspaceId);
  const run = (await runs.claimNext("background"))!;
  expect(run.id).toBe(source.runId);
  await runs.finish(run.id, { outcome: "finished", sessionId: "provider-context", error: null }, { stopEvidence: "provider_exited" });
  return source;
}

test("two rounds retain provider Session/logs, isolate attempts and receipts, and require fresh capabilities", async () => {
  const service = createExecutions(ports), runs = createRuns(ports, principal.workspaceId);
  const first = await service.start(principal, firstInput), run1 = (await runs.claimNext("background"))!;
  const inject = mock(async () => {});
  liveRuns.set(run1.id, { inject, abort: async () => {}, done: new Promise(() => {}) });
  const send = { ...sourceRef(first), op: "send" as const, commandKey: "send-1", text: "First round instruction" };
  await service.send(principal, send);
  await service.send(principal, send);
  expect(inject).toHaveBeenCalledTimes(1);
  // The binding comes from the retained attempt, rather than reconstructing a new log path.
  const logDir = join(root, "retained-provider-logs");
  await mkdir(logDir);
  await writeFile(join(logDir, "provider-log"), "first round context");
  await db.executionAttempt.update({ where: { id: first.attemptId }, data: { logDir } });
  await runs.finish(run1.id, { outcome: "finished", sessionId: "provider-context", error: null }, { stopEvidence: "provider_exited" });
  const retained = await db.executionAttempt.findUniqueOrThrow({ where: { id: first.attemptId }, include: { run: true } });
  const receipt = await db.executionCommand.findMany({ where: { attemptId: first.attemptId } });
  const snapshot = await ports.executionEvents!.snapshot(principal, first);
  const secondInput = { ...continuation(first), budget: { timeoutMs: 30_000, maxToolCalls: 2 } };
  const second = await service.start(principal, secondInput);
  expect(second.sessionId).toBe(first.sessionId);
  expect(second.workId).not.toBe(first.workId);
  expect(second.runId).not.toBe(first.runId);
  expect(second.attemptId).not.toBe(first.attemptId);
  expect(second).toMatchObject({ status: "queued", stopConfirmed: false, cancelRequested: false });
  expect(await db.session.count()).toBe(1);
  expect(await db.run.count()).toBe(2);
  expect(await db.executionAttempt.count()).toBe(2);
  expect(await db.executionAttempt.findUniqueOrThrow({ where: { id: second.attemptId } })).toMatchObject({ logDir, resolvedCwd: project, heldDirectory: project, budget: secondInput.budget, capabilityRevokedAt: null, stopConfirmedAt: null });
  expect(await readFile(join(logDir, "provider-log"), "utf8")).toBe("first round context");
  const run2 = (await runs.claimNext("background"))!;
  expect(run2).toMatchObject({ id: second.runId, prompt: "Second round", session: { id: first.sessionId, providerSessionId: "provider-context" } });
  expect(run2.deadlineAt.getTime() - ports.now().getTime()).toBe(30_000);
  expect(run2.token).not.toBe(run1.token);
  await expect(runs.authenticate(run1.token)).rejects.toMatchObject({ code: "forbidden" });
  expect(await runs.authenticate(run2.token)).toMatchObject({ run: { id: second.runId } });
  await expect(service.send(principal, { ...send, commandKey: "stale-send" })).rejects.toMatchObject({ code: "conflict" });
  await service.send(principal, send); // Original receipt still replays without reinjection.
  expect(inject).toHaveBeenCalledTimes(1);
  await runs.finish(run2.id, { outcome: "finished", sessionId: "provider-context", error: null }, { stopEvidence: "provider_exited" });
  expect(await service.get(principal, second.workId)).toMatchObject({ status: "completed", stopConfirmed: true });
  expect(await db.session.findUniqueOrThrow({ where: { id: first.sessionId } })).toMatchObject({ providerSessionId: "provider-context" });
  expect(await db.executionAttempt.findUniqueOrThrow({ where: { id: first.attemptId }, include: { run: true } })).toEqual(retained);
  expect(await db.executionCommand.findMany({ where: { attemptId: first.attemptId } })).toEqual(receipt);
  expect(await ports.executionEvents!.snapshot(principal, first)).toEqual(snapshot);
});

test("continuation start receipt replays exactly and rejects changed source, omitted source, key or work reuse", async () => {
  const service = createExecutions(ports), source = await stoppedSource(), input = continuation(source);
  const second = await service.start(principal, input);
  expect(await service.start(principal, { ...input, resumeFrom: { attemptId: source.attemptId, runId: source.runId, workId: source.workId } })).toEqual(second);
  expect(await service.lookupStart(principal, input.commandKey)).toEqual(second);
  for (const changed of [
    { ...input, resumeFrom: { ...input.resumeFrom!, attemptId: "different" } },
    { ...input, resumeFrom: undefined }, { ...input, workId: "other-turn" },
    { ...input, commandKey: "fresh-key" },
  ]) await expect(service.start(principal, changed)).rejects.toMatchObject({ code: "conflict" });
  expect(await service.start(principal, firstInput)).toMatchObject({ ...sourceRef(source), status: "completed" });
  expect(await db.run.count()).toBe(2);
  expect(await db.session.count()).toBe(1);
  expect(ports.onQueued).toHaveBeenCalledTimes(2);
});

test.each(["owner", "other-module", "other-owner", "other-workspace", "new-hash"])("resume denies a different principal: %s", async kind => {
  const service = createExecutions(ports), source = await stoppedSource();
  let other: ExecutionPrincipal = { ...principal };
  if (kind === "owner") {
    other = { ...principal, caller: { kind: "owner" } };
    expect(await service.get(other, source.workId)).toMatchObject(sourceRef(source));
  } else if (kind === "other-owner") other = { ...principal, ownerId: "different-owner" };
  else if (kind === "other-workspace") other = { workspaceId: (await db.workspace.create({ data: { name: "different-workspace" } })).id, ownerId: "owner", caller: { kind: "owner" } };
  else if (kind === "other-module") {
    const module = await db.module.create({ data: { workspaceId: principal.workspaceId, name: "other", activeHash: "hash", status: "active" } });
    other = { ...principal, caller: { kind: "module", moduleId: module.id, hash: "hash" } };
  } else if (principal.caller.kind === "module") {
    await db.module.update({ where: { id: principal.caller.moduleId }, data: { activeHash: "new-hash" } });
    other = { ...principal, caller: { ...principal.caller, hash: "new-hash" } };
  }
  await expect(service.start(other, continuation(source))).rejects.toMatchObject({ code: "not_found" });
  expect(await db.run.count()).toBe(1);
  expect(await db.session.count()).toBe(1);
});

test("owner can continue an owner execution, while a module cannot borrow its context", async () => {
  const owner: ExecutionPrincipal = { ...principal, caller: { kind: "owner" } }, source = await stoppedSource(owner), service = createExecutions(ports);
  await expect(service.start(principal, continuation(source))).rejects.toMatchObject({ code: "not_found" });
  expect(await service.start(owner, continuation(source))).toMatchObject({ sessionId: source.sessionId, workId: "turn-2" });
});

test.each([
  { status: "queued", stopped: false }, { status: "running", stopped: false }, { status: "running", stopped: true },
  { status: "queued", stopped: true }, { status: "failed", stopped: false }, { status: "finished", stopped: false },
  { status: "cancelled", stopped: false },
])("resume needs both terminal Run and actual stop evidence: $status / stop=$stopped", async ({ status, stopped }) => {
  const source = await createExecutions(ports).start(principal, firstInput);
  await db.run.update({ where: { id: source.runId }, data: { status } });
  // Terminal-looking rows without stop evidence still retain the directory guard's fallback reservation.
  await db.executionAttempt.update({ where: { id: source.attemptId }, data: { heldDirectory: null, stopConfirmedAt: stopped ? ports.now() : null } });
  await expect(createExecutions(ports).start(principal, continuation(source))).rejects.toMatchObject({ code: "conflict" });
  expect(await db.run.count()).toBe(1);
});

test.each(["path", "project-ref", "remote-source", "run-cwd"])("resume rejects changed project binding: %s", async kind => {
  const source = await stoppedSource(), input = continuation(source);
  if (kind === "path") { project = join(root, "changed-project"); await mkdir(project); }
  else if (kind === "project-ref") input.projectRef = "different-project";
  else if (kind === "remote-source") await db.executionAttempt.update({ where: { id: source.attemptId }, data: { executorId: "device", resolvedCwd: null } });
  else await db.run.update({ where: { id: source.runId }, data: { cwd: join(root, "different-project") } });
  await expect(createExecutions(ports).start(principal, input)).rejects.toMatchObject({ code: "conflict" });
  expect(await db.run.count()).toBe(1);
  expect(await db.session.count()).toBe(1);
});

test("continuing a stopped source still requires a fresh work ID", async () => {
  const source = await stoppedSource();
  await expect(createExecutions(ports).start(principal, { ...continuation(source), workId: source.workId })).rejects.toMatchObject({ code: "conflict" });
  expect(await db.run.count()).toBe(1);
  expect(await db.session.count()).toBe(1);
});

test("a stopped source cannot bypass a later execution's directory lock", async () => {
  const service = createExecutions(ports), source = await stoppedSource();
  await service.start(principal, { ...firstInput, workId: "occupying-turn", commandKey: "occupying-start" });
  await expect(service.start(principal, continuation(source))).rejects.toMatchObject({ code: "conflict" });
  expect(await db.run.count()).toBe(2);
});

test.each(["workId", "runId", "attemptId"] as const)("resume resolves the complete source tuple: %s mismatch", async field => {
  const source = await stoppedSource(), input = continuation(source);
  input.resumeFrom = { ...input.resumeFrom!, [field]: "unrelated" };
  await expect(createExecutions(ports).start(principal, input)).rejects.toMatchObject({ code: "not_found" });
  expect(await db.run.count()).toBe(1);
});

test("failed continuation admission rolls back new rows without changing the retained context", async () => {
  const source = await stoppedSource(), retained = await db.session.findUniqueOrThrow({ where: { id: source.sessionId } });
  ports.executionEvents!.admit = async () => { throw new Error("admission storage failed"); };
  await expect(createExecutions(ports).start(principal, continuation(source))).rejects.toThrow("admission storage failed");
  expect(await db.run.count()).toBe(1);
  expect(await db.executionAttempt.count()).toBe(1);
  expect(await db.session.findUniqueOrThrow({ where: { id: source.sessionId } })).toEqual(retained);
});

test("a completed newer round prevents resuming a stale ancestor but preserves admission replay", async () => {
  const service = createExecutions(ports), source = await stoppedSource(), input = continuation(source);
  const second = await service.start(principal, input), runs = createRuns(ports, principal.workspaceId);
  const run = (await runs.claimNext("background"))!;
  await runs.finish(run.id, { outcome: "finished", sessionId: "provider-context", error: null }, { stopEvidence: "provider_exited" });
  await expect(service.start(principal, { ...input, workId: "stale-branch", commandKey: "stale-branch" })).rejects.toMatchObject({ code: "conflict" });
  expect(await service.start(principal, input)).toMatchObject({ runId: second.runId });
  expect(await service.start(principal, { ...input, workId: "turn-3", commandKey: "start-3", resumeFrom: sourceRef(second) })).toMatchObject({ sessionId: source.sessionId });
});

test("missing Provider context cannot silently turn a continued conversation into a fresh one", async () => {
  const service = createExecutions(ports), source = await stoppedSource();
  await db.session.update({ where: { id: source.sessionId }, data: { providerSessionId: null } });
  await expect(service.start(principal, continuation(source))).rejects.toThrow("Provider context is unavailable");
  expect(await db.run.count()).toBe(1);
});

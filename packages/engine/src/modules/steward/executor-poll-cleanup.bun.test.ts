import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { EXECUTOR_LIMITS, EXECUTOR_PROTOCOL } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { createExecutorAuth } from "./executor-auth";
import { createExecutorControl } from "./executor-control";

test("more than a control page of stopped tombstones cannot starve live cancel or inject", async () => {
  const db = testDb(), now = new Date();
  try {
    const workspace = await db.workspace.create({ data: { name: "Poll control starvation" } });
    const ports: StewardPorts = { db, now: () => now, dataDir: "/tmp/not-read", publicUrl: null }, auth = createExecutorAuth(ports), control = createExecutorControl(ports);
    const credential = randomBytes(32).toString("hex"), pairing = await auth.createPairing({ workspaceId: workspace.id, ownerId: "owner" });
    const paired = await auth.pair(credential, { v: EXECUTOR_PROTOCOL, requestId: "pair", code: pairing.code, label: "Poll fixture" });
    const fence = { executorId: paired.executorId, generation: 1, incarnation: "poll-fixture" }, request = () => ({ v: EXECUTOR_PROTOCOL, requestId: crypto.randomUUID(), ...fence });
    await control.controller.reconcile(await auth.authenticateReconcile(credential, fence), { ...request(), entries: [], after: null, complete: true }, AbortSignal.timeout(5000));
    const who = await auth.authenticate(credential, fence, "active"), session = await db.session.create({ data: { workspaceId: workspace.id, key: crypto.randomUUID(), source: "web" } });
    const ids = Array.from({ length: EXECUTOR_LIMITS.controls + 3 }, (_, index) => ({ id: crypto.randomUUID(), assignmentId: index <= EXECUTOR_LIMITS.controls ? `a-${String(index).padStart(3, "0")}` : `z-${index}`, stopped: index <= EXECUTOR_LIMITS.controls, cancel: index <= EXECUTOR_LIMITS.controls + 1 }));
    await db.run.createMany({ data: ids.map(row => ({ id: `run-${row.id}`, workspaceId: workspace.id, sessionId: session.id, lane: "background", trigger: "execution", provider: "fixture", prompt: "probe", cwd: "/tmp/not-read", status: row.stopped ? "finished" : "running", startedAt: now, deadlineAt: new Date(now.getTime() + 60000), tokenHash: `hash-${row.id}` })) });
    await db.executionAttempt.createMany({ data: ids.map(row => ({ id: row.id, workspaceId: workspace.id, ownerId: "owner", callerKey: "owner", workId: `work-${row.id}`, commandKey: `start-${row.id}`, requestDigest: "fixture", runId: `run-${row.id}`, executorId: fence.executorId, executorGeneration: 1, projectRef: "project", projectDigest: "fixture", directoryIdentity: "a".repeat(64), mappingRevision: 1, logDir: "/tmp/not-read", baseline: `commit:${"b".repeat(40)}`, budget: { timeoutMs: 60000, maxToolCalls: 2 }, cancelRequestedAt: row.cancel ? now : null, stopConfirmedAt: row.stopped ? now : null, stopEvidence: row.stopped ? { kind: "never_started" } : undefined, heldDirectory: row.stopped ? null : `held-${row.id}` })) });
    await db.executorAssignment.createMany({ data: ids.map(row => ({ attemptId: row.id, assignmentId: row.assignmentId, executorId: fence.executorId, generation: 1, incarnation: fence.incarnation, preparedAt: now, offeredAt: row.stopped ? null : now, tombstoneDigest: row.stopped ? "c".repeat(64) : null })) });
    const cancel = ids.at(-2)!, inject = ids.at(-1)!, target = { workId: `work-${inject.id}`, sessionId: session.id, runId: `run-${inject.id}`, attemptId: inject.id, assignmentId: inject.assignmentId, generation: 1 };
    await db.executionCommand.create({ data: { attemptId: inject.id, commandKey: "live-inject", operation: "send", requestDigest: "fixture", receipt: {} } });
    await control.deliverRemoteControl({ target, commandKey: "live-inject", text: "live text" });
    const first = await control.controller.poll(who, { ...request(), waitMs: 0 }, AbortSignal.timeout(5000));
    expect(first.controls).toHaveLength(2); expect(first.controls).toContainEqual({ op: "cancel", target: { ...target, workId: `work-${cancel.id}`, runId: `run-${cancel.id}`, attemptId: cancel.id, assignmentId: cancel.assignmentId } }); expect(first.controls).toContainEqual({ op: "inject", target, commandKey: "live-inject", text: "live text" });
    const second = await control.controller.poll(who, { ...request(), waitMs: 0 }, AbortSignal.timeout(5000));
    expect(second.controls).toHaveLength(1); expect(second.controls[0]?.target.attemptId).toBe(cancel.id);
    expect(await db.executionAttempt.count({ where: { stopConfirmedAt: { not: null } } })).toBe(EXECUTOR_LIMITS.controls + 1);
  } finally { await db.$disconnect(); }
});

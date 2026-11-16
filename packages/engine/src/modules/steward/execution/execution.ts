import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import type { Prisma } from "@chrona/db";
import type { ExecutionCommand, ExecutionPorts, ExecutionPrincipal, ExecutionProjectGrant, ExecutionStart } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { CallError } from "../modules/module-calls";
import { createRuns, createRunSession, liveRuns } from "./runs";
import { createProviderControl, validateExecutionAnswer } from "../agent/provider-channel";
import { assertRetainedExecutionPrincipal } from "./execution-module-guard";
import { assertExecutionPrincipal } from "./execution-principal";
import { isExecutionControlValidationError, markExecutionControlRejected } from "./execution-control-error";
import { registerWorkspaceModule } from "./local-workspace";
import { runtimeCall } from "./local-runtime";
import { createExecutionDelivery } from "./execution-delivery";

import { executionBaseline, executionCallerKey, executionDigest, executionEventStore as events, executionRef, executionScope, executionView, executionNeverOfferedIn } from "./execution-state";
export async function trustedExecutionProject(ports: StewardPorts, principal: ExecutionPrincipal, projectRef: string) {
  if (!ports.resolveExecutionProject) throw new CallError("unavailable", "Execution projects are not configured");
  const project = await ports.resolveExecutionProject(principal, projectRef);
  executionBaseline(project.baseline);
  if (project.projectRef !== projectRef || !isAbsolute(project.canonicalPath) || normalize(project.canonicalPath) !== project.canonicalPath) throw new CallError("forbidden", "Project mapping is not canonical");
  try {
    if (await realpath(project.canonicalPath) !== project.canonicalPath || !(await stat(project.canonicalPath)).isDirectory()) throw new Error("Noncanonical project");
    await access(project.canonicalPath, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch { throw new CallError("forbidden", "Authorized project directory is unavailable"); }
  return project;
}
async function unique(tx: Prisma.TransactionClient, principal: ExecutionPrincipal, where: Prisma.ExecutionAttemptWhereInput) {
  const rows = await tx.executionAttempt.findMany({ where: { ...executionScope(principal), ...where }, include: { run: true }, take: 2 });
  if (!rows.length) throw new CallError("not_found", "Execution not found");
  if (rows.length !== 1) throw new CallError("conflict", "Execution reference is ambiguous");
  return rows[0]!;
}
/** Bind a fresh context or the exact caller's stopped context; owner read authority alone cannot resume it. */
async function executionSessionIn(ports: StewardPorts, tx: Prisma.TransactionClient, principal: ExecutionPrincipal, ref: ExecutionStart["resumeFrom"], project: ExecutionProjectGrant) {
  if (!ref) {
    const session = await createRunSession(tx, principal.workspaceId, principal.caller.kind === "module" ? "module" : "web", ports.now(), principal.caller.kind === "module" ? { moduleId: principal.caller.moduleId } : {});
    return { sessionId: session.id, logDir: join(ports.dataDir, "sessions", session.id) };
  }
  const source = await unique(tx, principal, { id: ref.attemptId, runId: ref.runId, workId: ref.workId,
    callerKey: executionCallerKey(principal), callerHash: principal.caller.kind === "module" ? principal.caller.hash : null });
  if (!source.stopConfirmedAt || !["finished", "failed", "timed_out", "cancelled", "provider_unavailable"].includes(source.run.status)) throw new CallError("conflict", "Resume source has not confirmed a terminal stop");
  if (source.executorId !== "server" || source.projectRef !== project.projectRef || source.resolvedCwd !== project.canonicalPath || source.run.cwd !== project.canonicalPath) throw new CallError("conflict", "Resume source belongs to a different project");
  const sessionId = executionRef(source).sessionId;
  await assertLatestContext(tx, sessionId, source.id);
  return { sessionId, logDir: source.logDir };
}
async function assertLatestContext(tx: Prisma.TransactionClient, sessionId: string, attemptId: string) {
  const session = await tx.session.findUnique({ where: { id: sessionId }, select: { providerSessionId: true, executionHeadAttemptId: true } });
  if (session?.executionHeadAttemptId !== attemptId) throw new CallError("conflict", "Resume source is no longer the latest conversation round");
  if (!session.providerSessionId) throw new CallError("conflict", "Previous Provider context is unavailable; start a new conversation explicitly");
}
export function createExecutions(ports: StewardPorts): ExecutionPorts {
  async function read(principal: ExecutionPrincipal, where: Prisma.ExecutionAttemptWhereInput) {
    return ports.db.$transaction(async tx => { await assertRetainedExecutionPrincipal(tx, principal); return executionView(await unique(tx, principal, where)); });
  }
  return {
    async start(principal, input) {
      const store = events(ports);
      const result = await ports.db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
        await assertRetainedExecutionPrincipal(tx, principal);
        const callerKey = executionCallerKey(principal), requestDigest = executionDigest(input);
        const existing = await tx.executionAttempt.findUnique({ where: { workspaceId_ownerId_callerKey_commandKey: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey, commandKey: input.commandKey } }, include: { run: true } });
        if (existing) {
          if (existing.requestDigest !== requestDigest || principal.caller.kind === "module" && existing.callerHash !== principal.caller.hash) throw new CallError("conflict", "Start key belongs to a different request or module version");
          return { view: executionView(existing), queued: false };
        }
        await assertExecutionPrincipal(tx, principal);
        const project = await trustedExecutionProject(ports, principal, input.projectRef);
        if (await tx.executionAttempt.count({ where: { ...executionScope(principal), callerKey, workId: input.workId } })) throw new CallError("conflict", "Work already has an execution");
        const session = await executionSessionIn(ports, tx, principal, input.resumeFrom, project);
        const run = await createRuns(ports, principal.workspaceId).enqueue({ sessionId: session.sessionId, lane: "background", trigger: "source", prompt: input.goal }, tx);
        await tx.run.update({ where: { id: run.id }, data: { cwd: project.canonicalPath } });
        // Track this live attempt for lifecycle/stop evidence without locking the shared project directory.
        const row = await tx.executionAttempt.create({ data: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey,
          moduleId: principal.caller.kind === "module" ? principal.caller.moduleId : null, callerHash: principal.caller.kind === "module" ? principal.caller.hash : null,
          workId: input.workId, commandKey: input.commandKey, requestDigest, runId: run.id, projectRef: project.projectRef, projectDigest: executionDigest(project),
          resolvedCwd: project.canonicalPath, logDir: session.logDir, baseline: project.baseline, budget: input.budget, heldDirectory: `execution:${run.id}` }, include: { run: true } });
        await tx.session.update({ where: { id: session.sessionId }, data: { executionHeadAttemptId: row.id } });
        const ref = executionRef(row);
        await store.admit(tx, principal, ref);
        await store.control(tx, principal, ref, { slot: "admission", at: ports.now().toISOString(), status: "confirmed" });
        return { view: executionView(row), queued: true };
      });
      // Admission must return before the queued Run can call back into the admitting SDK module.
      if (result.queued) void ports.onQueued?.().catch(error => console.error("Execution queue wake failed", error instanceof Error ? error.name : "unknown"));
      return result.view;
    },
    get: (principal, workId) => read(principal, { workId }),
    lookupStart: (principal, commandKey) => read(principal, { commandKey }),
    async resultSource(principal, input) {
      const snapshot = await ports.db.$transaction(async tx => {
        await assertRetainedExecutionPrincipal(tx, principal);
        const row = await unique(tx, principal, { id: input.attemptId, runId: input.runId, workId: input.workId });
        const delivery = row.targetBinding && row.stopConfirmedAt ? await tx.executionDelivery.findUnique({ where: { attemptId: row.id } }) : null;
        const changes = (delivery?.final as import("@chrona/contracts/steward").ExecutionDeliveryFinal | null)?.changes;
        return { row, changes };
      });
      const { row } = snapshot;
      registerWorkspaceModule();
      const changes = row.stopConfirmedAt && !row.targetBinding
        ? await runtimeCall<import("@chrona/contracts/steward").ExecutionResultSource["changes"]>(ports, principal.workspaceId, "workspace-local.result", { attemptId: row.id })
        : snapshot.changes;
      await assertRetainedExecutionPrincipal(ports.db, principal);
      return { ...executionRef(row), baseline: executionBaseline(row.baseline), ...(changes ? { changes } : {}) };
    },
    async list(principal, input) {
      return ports.db.$transaction(async tx => {
        await assertRetainedExecutionPrincipal(tx, principal);
        if (input.after) await unique(tx, principal, { id: input.after });
        const rows = await tx.executionAttempt.findMany({ where: { ...executionScope(principal), ...(input.after ? { id: { gt: input.after } } : {}) }, include: { run: true }, orderBy: { id: "asc" }, take: input.limit + 1 });
        const page = rows.slice(0, input.limit);
        return { works: page.map(executionView), after: rows.length > input.limit ? page.at(-1)!.id : null };
      });
    },
    async send(principal, input) { await controlExecution(ports, principal, input); },
    async answer(principal, input) { await controlExecution(ports, principal, input); },
    cancel: (principal, input) => controlExecution(ports, principal, input),
    async admitControl(principal, input) {
      const application = await admitApplicationControl(ports, principal, input);
      if (application) return { perform: false, operationId: application.runId };
      const admitted = await admitExecutionControl(ports, principal, input);
      return { perform: !admitted.replay && admitted.row.run.status === "running", operationId: admitted.row.runId };
    },
  };
}

type Control = Extract<ExecutionCommand, { op: "send" | "answer" | "cancel" }>;
async function admitExecutionControl(ports: StewardPorts, principal: ExecutionPrincipal, input: Control) {
  const admission = { consuming: false };
  try {
    return await ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
      await assertRetainedExecutionPrincipal(tx, principal);
      let row = await unique(tx, principal, { id: input.attemptId, workId: input.workId, runId: input.runId });
      const digest = executionDigest(input);
      const receipt = await tx.executionCommand.findUnique({ where: { attemptId_commandKey: { attemptId: row.id, commandKey: input.commandKey } } });
      if (receipt) {
        if (receipt.operation !== input.op || receipt.requestDigest !== digest) throw new CallError("conflict", "Command key was used for a different request");
        return { row, replay: true };
      }
      if (input.op !== "cancel") await assertExecutionPrincipal(tx, principal);
      await assertLiveControl(ports, tx, row, input);
      const now = ports.now();
      const command = { attemptId: row.id, commandKey: input.commandKey, operation: input.op, requestDigest: digest, receipt: { accepted: true, effect: "unknown" }, effect: "unknown", createdAt: now };
      admission.consuming = true;
      await tx.executionCommand.create({ data: command });
      if (input.op === "cancel" && !row.stopConfirmedAt) row = await cancelExecutionIn(ports, tx, principal, row, now);
      return { row, replay: false };
    });
  } catch (error) {
    if (!admission.consuming && isExecutionControlValidationError(error)) throw markExecutionControlRejected(error);
    throw error;
  }
}
async function admitApplicationControl(ports: StewardPorts, principal: ExecutionPrincipal, input: Control) {
  const row = await unique(ports.db, principal, { id: input.attemptId, workId: input.workId, runId: input.runId });
  if (!row.targetBinding) return null;
  const payload = input.op === "cancel" ? { operation: "cancel" as const } : input.op === "send" ? { operation: "write" as const, text: input.text } : { operation: "answer" as const, requestId: input.requestId, answer: input.answer };
  await createExecutionDelivery(ports).control(principal, row.workId, input.commandKey, payload);
  return ports.db.executionAttempt.findUniqueOrThrow({ where: { id: row.id }, include: { run: true } });
}
async function controlExecution(ports: StewardPorts, principal: ExecutionPrincipal, input: Control) {
    const application = await admitApplicationControl(ports, principal, input);
    if (application) return executionView(application);
    const result = await admitExecutionControl(ports, principal, input);
    if (!result.replay) {
      await deliverExecutionControl(ports, principal, input, result.row);
      await ports.db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
        await assertRetainedExecutionPrincipal(tx, principal);
        await tx.executionCommand.update({ where: { attemptId_commandKey: { attemptId: result.row.id, commandKey: input.commandKey } }, data: { effect: "confirmed", receipt: { accepted: true, effect: "confirmed" } } });
      });
    }
    return input.op === "cancel" ? ports.db.$transaction(async tx => { await assertRetainedExecutionPrincipal(tx, principal); return executionView(await unique(tx, principal, { id: result.row.id })); }) : executionView(result.row);
  }

type Attempt = Prisma.ExecutionAttemptGetPayload<{ include: { run: true } }>;
async function assertLiveControl(ports: StewardPorts, tx: Prisma.TransactionClient, row: Attempt, input: Control) {
  if (input.op === "cancel") return;
  if (row.run.status !== "running" || row.capabilityRevokedAt || !liveRuns.has(row.runId) || !row.run.deadlineAt || row.run.deadlineAt <= ports.now()) throw new CallError("conflict", "Execution is no longer live");
  if (input.op === "answer") await validateExecutionAnswer(ports, tx, { workspaceId: row.workspaceId, runId: row.runId, requestId: input.requestId, answer: input.answer });
}
async function cancelExecutionIn(ports: StewardPorts, tx: Prisma.TransactionClient, principal: ExecutionPrincipal, row: Attempt, now: Date) {
  row = await tx.executionAttempt.update({ where: { id: row.id }, data: { cancelRequestedAt: row.cancelRequestedAt ?? now, capabilityRevokedAt: row.capabilityRevokedAt ?? now }, include: { run: true } });
  const ref = executionRef(row);
  for (const slot of ["cancel", "revoke"] as const) await events(ports).control(tx, principal, ref, { slot, at: now.toISOString(), status: slot === "cancel" ? "requested" : "confirmed" });
  if (row.run.status === "queued" || await executionNeverOfferedIn(tx, row)) {
    await createRuns(ports, row.workspaceId).finishRunIn(tx, row.runId, { outcome: "unavailable", sessionId: null, error: "Cancelled by owner" }, now, "never_started");
    row = await tx.executionAttempt.findUniqueOrThrow({ where: { id: row.id }, include: { run: true } });
  }
  return row;
}
async function deliverExecutionControl(ports: StewardPorts, principal: ExecutionPrincipal, input: Control, row: Attempt) {
  // A durable receipt means consumed, never proof of injection; uncertain effects are not resent.
  if (input.op === "send") {
    const handle = liveRuns.get(row.runId);
    if (!handle) throw new CallError("unavailable", "Execution disconnected after command acceptance; delivery is unknown");
    await handle.inject(input.text);
  }
  if (input.op === "answer") await createProviderControl(ports, principal.workspaceId).answer(input.requestId, input.answer);
  if (input.op === "cancel" && row.run.status === "running") await liveRuns.get(row.runId)?.abort();
}

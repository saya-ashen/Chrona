import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import type { Prisma } from "@chrona/db";
import type { ExecutionCommand, ExecutionPorts, ExecutionPrincipal } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { CallError } from "./module-calls";
import { createRuns, createRunSession, liveRuns } from "./runs";
import { createProviderControl, validateExecutionAnswer } from "./provider-channel";
import { assertExecutionPrincipal } from "./execution-principal";
import { reserveDeviceCommandIn } from "./execution-control-budget";
import { remoteExecutionChanges } from "./execution-remote-completion";
import { registerWorkspaceModule } from "./local-workspace";
import { runtimeCall } from "./local-runtime";

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
export function createExecutions(ports: StewardPorts): ExecutionPorts {
  async function read(principal: ExecutionPrincipal, where: Prisma.ExecutionAttemptWhereInput) {
    return ports.db.$transaction(async tx => { await assertExecutionPrincipal(tx, principal); return executionView(await unique(tx, principal, where)); });
  }
  return {
    async start(principal, input) {
      const store = events(ports);
      const result = await ports.db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
        await assertExecutionPrincipal(tx, principal);
        const callerKey = executionCallerKey(principal), requestDigest = executionDigest(input);
        const existing = await tx.executionAttempt.findUnique({ where: { workspaceId_ownerId_callerKey_commandKey: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey, commandKey: input.commandKey } }, include: { run: true } });
        if (existing) {
          if (existing.requestDigest !== requestDigest || principal.caller.kind === "module" && existing.callerHash !== principal.caller.hash) throw new CallError("conflict", "Start key belongs to a different request or module version");
          return { view: executionView(existing), queued: false };
        }
        const project = await trustedExecutionProject(ports, principal, input.projectRef);
        if (await tx.executionAttempt.count({ where: { OR: [{ heldDirectory: project.canonicalPath }, { executorId: "server", resolvedCwd: project.canonicalPath, stopConfirmedAt: null }] } })) throw new CallError("conflict", "Project directory is occupied");
        if (await tx.executionAttempt.count({ where: { ...executionScope(principal), callerKey, workId: input.workId } })) throw new CallError("conflict", "Work already has an execution");
        const session = await createRunSession(tx, principal.workspaceId, "module", ports.now(), principal.caller.kind === "module" ? { moduleId: principal.caller.moduleId } : {});
        const run = await createRuns(ports, principal.workspaceId).enqueue({ sessionId: session.id, lane: "background", trigger: "source", prompt: input.goal }, tx);
        await tx.run.update({ where: { id: run.id }, data: { cwd: project.canonicalPath } });
        const row = await tx.executionAttempt.create({ data: { workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey,
          moduleId: principal.caller.kind === "module" ? principal.caller.moduleId : null, callerHash: principal.caller.kind === "module" ? principal.caller.hash : null,
          workId: input.workId, commandKey: input.commandKey, requestDigest, runId: run.id, projectRef: project.projectRef, projectDigest: executionDigest(project),
          resolvedCwd: project.canonicalPath, logDir: join(ports.dataDir, "sessions", session.id), baseline: project.baseline, budget: input.budget, heldDirectory: project.canonicalPath }, include: { run: true } });
        const ref = executionRef(row);
        await store.admit(tx, principal, ref);
        await store.control(tx, principal, ref, { slot: "admission", at: ports.now().toISOString(), status: "confirmed" });
        return { view: executionView(row), queued: true };
      });
      if (result.queued) await ports.onQueued?.();
      return result.view;
    },
    get: (principal, workId) => read(principal, { workId }),
    lookupStart: (principal, commandKey) => read(principal, { commandKey }),
    async resultSource(principal, input) {
      const snapshot = await ports.db.$transaction(async tx => {
        await assertExecutionPrincipal(tx, principal);
        const row = await unique(tx, principal, { id: input.attemptId, runId: input.runId, workId: input.workId });
        const changes = row.stopConfirmedAt && row.executorId !== "server" ? await remoteExecutionChanges(tx, row.id) : undefined;
        return { row, changes };
      });
      const { row } = snapshot;
      registerWorkspaceModule();
      const changes = row.stopConfirmedAt && row.executorId === "server"
        ? await runtimeCall<import("@chrona/contracts/steward").ExecutionResultSource["changes"]>(ports, principal.workspaceId, "workspace-local.result", { attemptId: row.id })
        : snapshot.changes;
      await assertExecutionPrincipal(ports.db, principal);
      return { ...executionRef(row), baseline: executionBaseline(row.baseline), ...(changes ? { changes } : {}) };
    },
    async list(principal, input) {
      return ports.db.$transaction(async tx => {
        await assertExecutionPrincipal(tx, principal);
        if (input.after) await unique(tx, principal, { id: input.after });
        const rows = await tx.executionAttempt.findMany({ where: { ...executionScope(principal), ...(input.after ? { id: { gt: input.after } } : {}) }, include: { run: true }, orderBy: { id: "asc" }, take: input.limit + 1 });
        const page = rows.slice(0, input.limit);
        return { works: page.map(executionView), after: rows.length > input.limit ? page.at(-1)!.id : null };
      });
    },
    async send(principal, input) { await controlExecution(ports, principal, input); },
    async answer(principal, input) { await controlExecution(ports, principal, input); },
    cancel: (principal, input) => controlExecution(ports, principal, input),
  };
}

type Control = Extract<ExecutionCommand, { op: "send" | "answer" | "cancel" }>;
async function controlExecution(ports: StewardPorts, principal: ExecutionPrincipal, input: Control) {
    const result = await ports.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
      await assertExecutionPrincipal(tx, principal);
      let row = await unique(tx, principal, { id: input.attemptId, workId: input.workId, runId: input.runId });
      const digest = executionDigest(input);
      const receipt = await tx.executionCommand.findUnique({ where: { attemptId_commandKey: { attemptId: row.id, commandKey: input.commandKey } } });
      if (receipt) {
        if (receipt.operation !== input.op || receipt.requestDigest !== digest) throw new CallError("conflict", "Command key was used for a different request");
        return { row, replay: true };
      }
      await assertLiveControl(ports, tx, row, input);
      const now = ports.now();
      const command = { attemptId: row.id, commandKey: input.commandKey, operation: input.op, requestDigest: digest, receipt: { accepted: true, effect: "unknown" }, effect: "unknown", createdAt: now };
      if (row.executorId !== "server") await reserveDeviceCommandIn(tx, row.executorId, command);
      await tx.executionCommand.create({ data: command });
      if (input.op === "cancel" && !row.stopConfirmedAt) row = await cancelExecutionIn(ports, tx, principal, row, now);
      return { row, replay: false };
    });
    if (input.op === "cancel" && result.row.executorId !== "server" && result.row.stopConfirmedAt) await ports.remoteCompletion?.committed(principal.workspaceId, result.row.runId);
    if (!result.replay) await deliverExecutionControl(ports, principal, input, result.row);
    return input.op === "cancel" ? ports.db.$transaction(async tx => { await assertExecutionPrincipal(tx, principal); return executionView(await unique(tx, principal, { id: result.row.id })); }) : executionView(result.row);
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
    if (row.executorId === "server") {
      const handle = liveRuns.get(row.runId);
      if (!handle) throw new CallError("unavailable", "Execution disconnected after command acceptance; delivery is unknown");
      await handle.inject(input.text);
    } else {
      if (!ports.deliverRemoteControl) throw new CallError("unavailable", "Remote control delivery unavailable; delivery is unknown");
      const assignment = await ports.db.executorAssignment.findUniqueOrThrow({ where: { attemptId: row.id } });
      await ports.deliverRemoteControl({ target: { ...executionRef(row), assignmentId: assignment.assignmentId, generation: assignment.generation }, commandKey: input.commandKey, text: input.text });
    }
  }
  if (input.op === "answer") await createProviderControl(ports, principal.workspaceId).answer(input.requestId, input.answer);
  if (input.op === "cancel" && row.run.status === "running") await liveRuns.get(row.runId)?.abort();
}

import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

type ManualLifecycleAction = "complete" | "reopen";
type ManualLifecycleInput = {
  taskId: string;
  workspaceId: string;
  expectedRevision: string;
  requestId: string;
};

type ManualLifecycleReceipt = {
  taskId: string;
  workspaceId: string;
  action: ManualLifecycleAction;
  requestId: string;
  expectedRevision: string;
  applied: boolean;
  status: TaskStatus;
  completedAt: string | null;
  revision: string;
};

const revisionFor = (configRevision: number) => `config-v1:${configRevision}`;
const receiptKey = (workspaceId: string, requestId: string) =>
  `task.manual-lifecycle:${workspaceId}:${requestId}`;

function receiptFromPayload(payload: unknown): ManualLifecycleReceipt | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  const receipt = value.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
  return receipt as ManualLifecycleReceipt;
}

function sameRequest(receipt: ManualLifecycleReceipt, input: ManualLifecycleInput, action: ManualLifecycleAction) {
  return receipt.taskId === input.taskId &&
    receipt.workspaceId === input.workspaceId &&
    receipt.action === action &&
    receipt.requestId === input.requestId &&
    receipt.expectedRevision === input.expectedRevision;
}

function lifecycleTransition(
  task: { id: string; workspaceId: string; status: TaskStatus; completedAt: Date | null; configRevision: number },
  input: ManualLifecycleInput,
  action: ManualLifecycleAction,
) {
  const nextStatus = action === "complete" ? TaskStatus.Done : TaskStatus.Ready;
  const isNoop = task.status === nextStatus;
  const completedAt = action === "complete" ? (task.completedAt ?? new Date()) : null;
  const nextRevision = isNoop ? task.configRevision : task.configRevision + 1;
  const receipt: ManualLifecycleReceipt = {
    taskId: task.id,
    workspaceId: task.workspaceId,
    action,
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    applied: !isNoop,
    status: nextStatus,
    completedAt: completedAt?.toISOString() ?? null,
    revision: revisionFor(nextRevision),
  };
  return { nextStatus, isNoop, completedAt, receipt };
}

/**
 * Direct manual lifecycle command. The canonical event is also the durable
 * request receipt: it is written in the same transaction as the CAS update.
 * It deliberately owns no Plan, Run, provider, or execution-session state.
 */
async function runManualLifecycle(input: ManualLifecycleInput, action: ManualLifecycleAction) {
  const key = receiptKey(input.workspaceId, input.requestId);
  const projection = { shouldRebuild: false };
  const receipt = await db.$transaction(async (tx) => {
    const prior = await tx.event.findUnique({ where: { dedupeKey: key } });
    if (prior) {
      const stored = receiptFromPayload(prior.payload);
      if (!stored || !sameRequest(stored, input, action)) {
        throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "requestId already identifies a different manual lifecycle command.");
      }
      return { ...stored, replayed: true };
    }

    const task = await tx.task.findFirst({
      where: { id: input.taskId, workspaceId: input.workspaceId },
      select: { id: true, workspaceId: true, taskExecutionMode: true, status: true, completedAt: true, configRevision: true },
    });
    if (!task) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
    if (task.taskExecutionMode !== "manual") {
      throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "This action is only available for manual tasks.");
    }
    if (revisionFor(task.configRevision) !== input.expectedRevision) {
      throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Task changed. Read it before deciding how to retry.");
    }

    const { nextStatus, isNoop, completedAt, receipt } = lifecycleTransition(task, input, action);

    if (!isNoop) {
      const updated = await tx.task.updateMany({
        where: { id: task.id, workspaceId: input.workspaceId, taskExecutionMode: "manual", configRevision: task.configRevision },
        data: {
          status: nextStatus,
          completedAt,
          blockReason: Prisma.DbNull,
          configRevision: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Task changed. Read it before deciding how to retry.");
      }
      projection.shouldRebuild = true;
    }

    await appendCanonicalEvent({
      eventType: isNoop ? "task.manual_lifecycle_receipt" : action === "complete" ? "task.done" : "task.reopened",
      workspaceId: task.workspaceId,
      taskId: task.id,
      workBlockId: null,
      actorType: "user",
      actorId: "server-action",
      source: "ui",
      payload: {
        previous_status: task.status,
        next_status: nextStatus,
        task_execution_mode: "manual",
        receipt,
      },
      dedupeKey: key,
    }, tx);
    return { ...receipt, replayed: false };
  });

  // Projection rebuilding is recoverable from the durable task/event command;
  // retrying the identical request reaches this point without reapplying state.
  if (projection.shouldRebuild) await rebuildTaskProjection(input.taskId);
  return receipt;
}

export function completeManualTask(input: ManualLifecycleInput) {
  return runManualLifecycle(input, "complete");
}

export function reopenManualTask(input: ManualLifecycleInput) {
  return runManualLifecycle(input, "reopen");
}

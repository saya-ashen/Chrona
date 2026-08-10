import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { createLogger } from "@chrona/logging";
import type { SubmittedNodeResult } from "@chrona/contracts/ai";
import type { SyncPlanRunRuntimeResultInput } from "../types";
import { executeCommand } from "./execute-command";
import { isStaleRuntimeResultSyncError } from "./runtime-result-sync-errors";
import { canonicalJsonString } from "./command-receipts";
import type { SchedulerWorkContext } from "@/modules/orchestration/scheduler-lease-repository";
import { ENGINE_ERROR_CODES, EngineError } from "../../../errors";
const logger = createLogger("engine.plan-execution.sync");
export type RuntimeSyncIdentity = {
  planRunId: string;
  workBlockId: string | null;
  expectedAttemptId: string;
  providerRunId: string;
};
type ResolvedRuntimeSyncIdentity = RuntimeSyncIdentity & {
  executionSessionId: string;
  executionSessionStatus: "Active" | "Paused" | "Completed" | "Abandoned";
};

async function resolveRuntimeSyncIdentity(input: SyncPlanRunRuntimeResultInput): Promise<ResolvedRuntimeSyncIdentity> {
  const runtimeRunRef = input.runtimeRunRef.trim();
  if (!runtimeRunRef || !input.expectedAttemptId || !input.providerRunId) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Runtime result sync requires exact runtimeRunRef, expectedAttemptId, and providerRunId.",
    );
  }

  const providerRun = await db.taskPlanProviderRun.findFirst({
    where: {
      id: input.providerRunId,
      taskId: input.taskId,
      nodeAttemptId: input.expectedAttemptId,
      run: { runtimeRunRef },
    },
    select: {
      id: true,
      nodeAttemptId: true,
      planRunId: true,
      planRun: { select: { planId: true, workBlockId: true } },
    },
  });
  if (!providerRun) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Runtime result sync does not match one durable provider run identity.",
    );
  }
  const executionSession = await db.executionSession.findFirst({
    where: {
      taskId: input.taskId,
      planId: providerRun.planRun.planId,
      workBlockId: providerRun.planRun.workBlockId,
      currentNodeAttemptId: providerRun.nodeAttemptId,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (!executionSession) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Runtime result sync does not match one durable execution session identity.",
    );
  }
  const resolvedWorkBlockId = providerRun.planRun.workBlockId;
  if (Object.hasOwn(input, "workBlockId") && input.workBlockId !== resolvedWorkBlockId) {
    throw new EngineError(
      ENGINE_ERROR_CODES.CONFLICT,
      "Runtime result sync workBlockId does not match the durable provider run scope.",
    );
  }
  return {
    planRunId: providerRun.planRunId,
    workBlockId: resolvedWorkBlockId,
    expectedAttemptId: providerRun.nodeAttemptId,
    providerRunId: providerRun.id,
    executionSessionId: executionSession.id,
    executionSessionStatus: executionSession.status,
  };
}

export function runtimeSyncIdempotencyKey(input: SyncPlanRunRuntimeResultInput, identity: RuntimeSyncIdentity): string {
  const payload = canonicalJsonString({
    durable: {
      taskId: input.taskId,
      workBlockId: identity.workBlockId,
      planRunId: identity.planRunId,
      providerRunId: identity.providerRunId,
      expectedAttemptId: identity.expectedAttemptId,
      runtimeRunRef: input.runtimeRunRef.trim(),
    },
    terminal: {
      status: input.status,
      summary: input.summary ?? null,
      error: input.error ?? null,
      output: input.output ?? null,
    },
  });
  return `runtime-sync:${createHash("sha256").update(payload).digest("hex")}`;
}
/**
 * Out-of-band provider result. In the single-writer model this is just an
 * ordinary submit_node_result command (correlated by runtimeRunRef) routed
 * through the same kernel writer — no separate dispatch path or committed-state
 * reconciliation.
 */
export async function syncPlanRunRuntimeResult(
  input: SyncPlanRunRuntimeResultInput & { workContext?: SchedulerWorkContext },
): Promise<void> {
  const identity = await resolveRuntimeSyncIdentity(input);
  const result: SubmittedNodeResult = (() => {
    if (input.status === "Completed") {
      if (input.output !== undefined) {
        return { kind: "done", summary: input.summary ?? undefined, output: input.output };
      }
      const message = "Runtime run completed without a Chrona terminal result action";
      return { kind: "failed", error: input.summary ? `${message}: ${input.summary}` : message };
    }
    return input.status === "Cancelled"
      ? { kind: "cancelled", reason: input.summary ?? undefined }
      : { kind: "failed", error: input.error ?? input.summary ?? "Runtime run failed" };
  })();

  try {
    await executeCommand({
      taskId: input.taskId,
      command: {
        type: "submit_node_result",
        runtimeRunRef: input.runtimeRunRef.trim(),
        expectedAttemptId: identity.expectedAttemptId,
        providerRunId: identity.providerRunId,
        continueExecution: identity.executionSessionStatus === "Active",
        result,
      },
      context: {
        workBlockId: identity.workBlockId,
        providerRunId: identity.providerRunId,
        nodeAttemptId: identity.expectedAttemptId,
        idempotencyKey: runtimeSyncIdempotencyKey(input, identity),
        sessionId: identity.executionSessionId,
        trigger: "system",
        actor: {
          type: "system",
          service: "runtime-sync",
          reason: input.status.toLowerCase(),
        },
        origin: { channel: "provider_stream" },
      },
      workContext: input.workContext,
    });
  } catch (cause) {
    if (isStaleRuntimeResultSyncError(cause)) {
      logger.warn("runtime_sync.stale", {
        taskId: input.taskId,
        runtimeRunRef: input.runtimeRunRef,
        status: input.status,
        reason: cause.reason,
      });
      return;
    }
    logger.error("runtime_sync.failed", {
      taskId: input.taskId,
      runtimeRunRef: input.runtimeRunRef,
      status: input.status,
      error: cause,
    });
    throw cause;
  }
}

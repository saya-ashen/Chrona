import { createLogger } from "@chrona/logging";
import type { SubmittedNodeResult } from "@chrona/contracts/ai";
import type { SyncPlanRunRuntimeResultInput } from "../types";
import { executeCommand } from "./execute-command";
import { isStaleRuntimeResultSyncError } from "./runtime-result-sync-errors";

const logger = createLogger("engine.plan-execution.sync");


/**
 * Out-of-band provider result. In the single-writer model this is just an
 * ordinary submit_node_result command (correlated by runtimeRunRef) routed
 * through the same kernel writer — no separate dispatch path or committed-state
 * reconciliation.
 */
export async function syncPlanRunRuntimeResult(
  input: SyncPlanRunRuntimeResultInput,
): Promise<void> {
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
        runtimeRunRef: input.runtimeRunRef,
        result,
      },
      context: {
        trigger: "system",
        actor: {
          type: "system",
          service: "runtime-sync",
          reason: input.status.toLowerCase(),
        },
        origin: { channel: "provider_stream" },
      },
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

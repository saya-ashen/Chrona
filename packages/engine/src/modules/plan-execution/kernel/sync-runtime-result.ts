import { createLogger } from "@chrona/shared/logger";
import type { SubmittedNodeResult } from "@chrona/contracts/ai";
import type { SyncPlanRunRuntimeResultInput } from "../types";
import { executeCommand } from "./execute-command";

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
  const result: SubmittedNodeResult =
    input.status === "Completed"
      ? { kind: "done", summary: input.summary ?? undefined, output: input.output }
      : input.status === "Cancelled"
        ? { kind: "cancelled", reason: input.summary ?? undefined }
        : { kind: "failed", error: input.error ?? input.summary ?? "Runtime run failed" };

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
    // No running attempt matches the runtimeRunRef (stale/duplicate sync): ignore.
    logger.warn("runtime_sync.ignored", {
      taskId: input.taskId,
      runtimeRunRef: input.runtimeRunRef,
      status: input.status,
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

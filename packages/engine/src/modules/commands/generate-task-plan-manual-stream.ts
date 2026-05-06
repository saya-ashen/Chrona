import { db } from "@/lib/db";
import { aiGeneratePlanStream } from "@/modules/ai/ai-service";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import { resolveRuntimeAdapterKey } from "@/modules/task-execution/registry";
import { materializeGeneratedTaskPlan } from "@/modules/commands/materialize-generated-task-plan";
import type { GeneratePlanSSEEvent, PlanBlueprint } from "@chrona/contracts";
import { createLogger } from "@/lib/logger";

const logger = createLogger("command.generate-task-plan-manual-stream");

/**
 * Manual plan generation stream — the only engine entry point for generating
 * a plan. Orchestrates provider streaming, extracts the authoritative tool
 * payload, materializes the plan, and emits canonical SSE events.
 *
 * No cached/saved branch — always generates fresh. No legacy compatibility shapes.
 */
export async function* generateTaskPlanManualStream(input: {
  taskId: string;
  forceRefresh?: boolean;
  planningPrompt?: string | null;
}): AsyncGenerator<GeneratePlanSSEEvent> {
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    include: {
      workBlocks: {
        where: { status: { in: ["Scheduled", "Active"] } },
        orderBy: { scheduledStartAt: "asc" },
        take: 1,
      },
    },
  });

  if (!task) {
    yield {
      type: "error",
      code: "TASK_NOT_FOUND",
      message: "Task not found",
    };
    return;
  }

  yield {
    type: "status",
    phase: "loading_task",
    message: "Loading task context...",
  };

  const taskSessionKey = (
    await ensureDefaultTaskSession({
      taskId: task.id,
      taskTitle: task.title,
      runtimeName: resolveRuntimeAdapterKey({ runtimeAdapterKey: task.runtimeAdapterKey }),
      defaultSessionId: task.defaultSessionId,
    })
  ).sessionKey;

  const currentWorkBlock = task.workBlocks[0] ?? null;
  const estimatedMinutes =
    currentWorkBlock?.scheduledStartAt && currentWorkBlock.scheduledEndAt
      ? Math.round(
          (currentWorkBlock.scheduledEndAt.getTime() -
            currentWorkBlock.scheduledStartAt.getTime()) /
            60000,
        )
      : undefined;

  yield {
    type: "status",
    phase: "requesting_provider",
    message: "Requesting AI provider...",
  };

  let hasToolPayload = false;

  for await (const event of aiGeneratePlanStream({
    taskId: task.id,
    title: task.title,
    description: task.description ?? undefined,
    estimatedMinutes,
    planningPrompt: input.planningPrompt ?? undefined,
    sessionKey: taskSessionKey,
  })) {
    switch (event.type) {
      case "status":
        yield {
          type: "status",
          phase: "streaming",
          message: event.message,
        };
        break;

      case "tool_call":
        if (event.tool === "generate_task_plan_graph") {
          hasToolPayload = true;
          yield {
            type: "tool_call",
            tool: "generate_task_plan_graph",
            input: event.input as unknown as PlanBlueprint,
          };
        } else {
          yield {
            type: "status",
            phase: "streaming",
            message: `Tool call: ${event.tool}`,
          };
        }
        break;

      case "partial":
        yield { type: "partial", text: event.text };
        break;

      case "result":
        if ("plan" in event) {
          const plan = event.plan;
          if (plan.blueprint.nodes.length === 0) {
            yield {
              type: "error",
              code: "EMPTY_PLAN",
              message: "AI returned an empty task plan with zero nodes.",
            };
            return;
          }

          yield {
            type: "status",
            phase: "compiling",
            message: "Compiling plan blueprint...",
          };

          try {
            const readModel = await materializeGeneratedTaskPlan({
              taskId: task.id,
              workspaceId: task.workspaceId,
              blueprint: plan.blueprint,
              planningPrompt: input.planningPrompt ?? null,
              generatedBy: plan.source,
            });

            yield { type: "result", result: readModel, taskSessionKey };
          } catch (error) {
            logger.error("materialize_failed", {
              taskId: task.id,
              error: error instanceof Error ? error.message : String(error),
            });
            yield {
              type: "error",
              code: "INTERNAL_ERROR",
              message: error instanceof Error
                ? error.message
                : "Failed to persist generated plan.",
            };
            return;
          }
        }
        break;

      case "error": {
        // Map provider errors to structured error codes
        const msg = event.message;
        let code: "PROVIDER_ERROR" | "NO_AI_CLIENT" = "PROVIDER_ERROR";
        if (msg.includes("No AI client")) code = "NO_AI_CLIENT";
        yield { type: "error", code, message: msg };
        return;
      }

      case "done":
        if (!hasToolPayload) {
          yield {
            type: "error",
            code: "INVALID_TOOL_PAYLOAD",
            message: "Provider completed without a generate_task_plan_graph tool payload.",
          };
          return;
        }
        break;
    }

    if (event.type === "done") break;
  }

  yield { type: "done" };
}

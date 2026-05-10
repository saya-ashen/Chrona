import { db } from "@/lib/db";
import { aiGeneratePlanStream } from "@/modules/ai/runtime/ai-service";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import { resolveExecutionRuntime } from "@/modules/task-execution/registry";
import { materializeGeneratedTaskPlan } from "@/modules/plans/materialize-generated-task-plan";
import type { GeneratePlanSSEEvent, PlanBlueprint } from "@chrona/contracts";
import { createLogger } from "@/lib/logger";

const logger = createLogger("command.generate-task-plan-manual-stream");

function hasNonEmptyPlanBlueprint(
  plan: unknown,
): plan is { blueprint: PlanBlueprint; source: string } {
  if (!plan || typeof plan !== "object") {
    return false;
  }

  const blueprint = (plan as { blueprint?: unknown }).blueprint;
  if (!blueprint || typeof blueprint !== "object") {
    return false;
  }

  return Array.isArray((blueprint as { nodes?: unknown }).nodes)
    && (blueprint as { nodes: unknown[] }).nodes.length > 0;
}

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
      runtimeName: resolveExecutionRuntime({
        executionRuntime: task.executionRuntime,
      }),
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

  const executionConfig =
    task.executionConfig && typeof task.executionConfig === "object" && !Array.isArray(task.executionConfig)
      ? task.executionConfig as Record<string, unknown>
      : {};
  const planningPrompt = typeof executionConfig.prompt === "string" ? executionConfig.prompt : null;

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
    planningPrompt,
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
          if (!hasNonEmptyPlanBlueprint(plan)) {
            yield {
              type: "error",
              code: "INVALID_TOOL_PAYLOAD",
              message:
                "AI returned an invalid task plan payload: missing blueprint.nodes or zero nodes.",
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
              planningPrompt,
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
              message:
                error instanceof Error
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
        yield {
          type: "error",
          code,
          message: msg,
          rawText: event.rawText,
          diagnostics: event.diagnostics,
        };
        return;
      }

      case "done":
        if (!hasToolPayload) {
          yield {
            type: "error",
            code: "INVALID_TOOL_PAYLOAD",
            message:
              "Provider completed without a generate_task_plan_graph tool payload.",
          };
          return;
        }
        break;
    }

    if (event.type === "done") break;
  }

  yield { type: "done" };
}

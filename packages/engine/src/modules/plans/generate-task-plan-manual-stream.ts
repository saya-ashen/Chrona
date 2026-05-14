import { db } from "@/lib/db";
import { aiGeneratePlanStream } from "@/modules/ai/runtime/ai-service";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import { resolveExecutionRuntime } from "@/modules/task-execution/registry";
import { materializeGeneratedTaskPlan } from "@/modules/plans/materialize-generated-task-plan";
import type { GeneratePlanSSEEvent, PlanBlueprint } from "@chrona/contracts";
import { createDebugDump, previewDebugValue } from "@chrona/shared/debug-dump";
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

function summarizeGeneratePlanEvent(event: GeneratePlanSSEEvent) {
  switch (event.type) {
    case "partial":
      return {
        type: event.type,
        textLength: event.text.length,
        text: previewDebugValue(event.text, 300),
      };
    case "tool_call":
      return {
        type: event.type,
        tool: event.tool,
        input: previewDebugValue(event.input, 1200),
      };
    case "result":
      return {
        type: event.type,
        result: previewDebugValue(event.result, 1200),
        taskSessionKey: event.taskSessionKey,
      };
    case "error":
      return {
        type: event.type,
        code: event.code,
        message: event.message,
        diagnostics: previewDebugValue(event.diagnostics, 1200),
      };
    default:
      return { ...event };
  }
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
  signal?: AbortSignal;
}): AsyncGenerator<GeneratePlanSSEEvent> {
  const dump = await createDebugDump({
    enabledEnv: "CHRONA_AI_STREAM_DUMP",
    directoryEnv: "CHRONA_AI_STREAM_DUMP_DIR",
    kind: "ai-stream",
    label: `manual-plan-${input.taskId}`,
    meta: {
      layer: "engine.generateTaskPlanManualStream",
      taskId: input.taskId,
      forceRefresh: input.forceRefresh ?? false,
    },
  });

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
    const event: GeneratePlanSSEEvent = {
      type: "error",
      code: "TASK_NOT_FOUND",
      message: "Task not found",
    };
    await dump?.write({ type: "yield", stage: "task_missing", event: summarizeGeneratePlanEvent(event) });
    yield event;
    await dump?.close();
    return;
  }

  const loadingEvent: GeneratePlanSSEEvent = {
    type: "status",
    phase: "loading_task",
    message: "Loading task context...",
  };
  await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(loadingEvent) });
  yield loadingEvent;

  const taskSessionKey = (
    await ensureDefaultTaskSession({
      taskId: task.id,
      taskTitle: task.title,
      runtimeName: resolveExecutionRuntime({
        executionRuntime: task.executionRuntime,
      }),
      defaultSessionId: task.defaultSessionId,
      suffix: "plan-graph",
      label: `${task.title} · Plan graph generation session`,
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

  await dump?.write({
    type: "task_context",
    taskId: task.id,
    workspaceId: task.workspaceId,
    taskSessionKey,
    estimatedMinutes: estimatedMinutes ?? null,
    hasPlanningPrompt: Boolean(planningPrompt),
  });

  const requestingEvent: GeneratePlanSSEEvent = {
    type: "status",
    phase: "requesting_provider",
    message: "Requesting AI provider...",
  };
  await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(requestingEvent) });
  yield requestingEvent;

  let hasToolPayload = false;

  if (input.signal?.aborted) {
    const event: GeneratePlanSSEEvent = { type: "cancelled" };
    await dump?.write({ type: "yield", stage: "aborted_before_provider", event });
    yield event;
    await dump?.close();
    return;
  }

  for await (const event of aiGeneratePlanStream({
    taskId: task.id,
    title: task.title,
    description: task.description ?? undefined,
    estimatedMinutes,
    planningPrompt,
    sessionKey: taskSessionKey,
    signal: input.signal,
  })) {
    await dump?.write({
      type: "ai_event",
      event: previewDebugValue(event, 1200) as Record<string, unknown>,
    });
    if (input.signal?.aborted) {
      const cancelledEvent: GeneratePlanSSEEvent = { type: "cancelled" };
      await dump?.write({ type: "yield", stage: "aborted_during_provider", event: cancelledEvent });
      yield cancelledEvent;
      await dump?.close();
      return;
    }

    switch (event.type) {
      case "status":
        {
          const statusEvent: GeneratePlanSSEEvent = {
          type: "status",
          phase: "streaming",
          message: event.message,
          };
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(statusEvent) });
          yield statusEvent;
        }
        break;

      case "tool_call":
        if (event.tool === "generate_task_plan_graph") {
          hasToolPayload = true;
          const toolEvent: GeneratePlanSSEEvent = {
            type: "tool_call",
            tool: "generate_task_plan_graph",
            input: event.input as unknown as PlanBlueprint,
          };
          await dump?.write({
            type: "state",
            field: "hasToolPayload",
            value: hasToolPayload,
          });
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(toolEvent) });
          yield toolEvent;
        } else {
          const statusEvent: GeneratePlanSSEEvent = {
            type: "status",
            phase: "streaming",
            message: `Tool call: ${event.tool}`,
          };
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(statusEvent) });
          yield statusEvent;
        }
        break;

      case "partial":
        {
          const partialEvent: GeneratePlanSSEEvent = { type: "partial", text: event.text };
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(partialEvent) });
          yield partialEvent;
        }
        break;

      case "result":
        if ("plan" in event) {
          const plan = event.plan;
          if (!hasNonEmptyPlanBlueprint(plan)) {
            const errorEvent: GeneratePlanSSEEvent = {
              type: "error",
              code: "INVALID_TOOL_PAYLOAD",
              message:
                "AI returned an invalid task plan payload: missing blueprint.nodes or zero nodes.",
            };
            await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(errorEvent) });
            yield errorEvent;
            await dump?.close();
            return;
          }

          const compilingEvent: GeneratePlanSSEEvent = {
            type: "status",
            phase: "compiling",
            message: "Compiling plan blueprint...",
          };
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(compilingEvent) });
          yield compilingEvent;

          try {
            await dump?.write({
              type: "materialize_start",
              taskId: task.id,
              workspaceId: task.workspaceId,
              blueprint: previewDebugValue(plan.blueprint, 1200),
            });
            const readModel = await materializeGeneratedTaskPlan({
              taskId: task.id,
              workspaceId: task.workspaceId,
              blueprint: plan.blueprint,
              planningPrompt,
              generatedBy: plan.source,
            });

            const resultEvent: GeneratePlanSSEEvent = { type: "result", result: readModel, taskSessionKey };
            await dump?.write({ type: "materialize_result", result: previewDebugValue(readModel, 1200) });
            await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(resultEvent) });
            yield resultEvent;
          } catch (error) {
            logger.error("materialize_failed", {
              taskId: task.id,
              error: error instanceof Error ? error.message : String(error),
            });
            const errorEvent: GeneratePlanSSEEvent = {
              type: "error",
              code: "INTERNAL_ERROR",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to persist generated plan.",
            };
            await dump?.write({
              type: "materialize_error",
              message: error instanceof Error ? error.message : String(error),
            });
            await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(errorEvent) });
            yield errorEvent;
            await dump?.close();
            return;
          }
        }
        break;

      case "error": {
        // Map provider errors to structured error codes
        const msg = event.message;
        let code: "PROVIDER_ERROR" | "NO_AI_CLIENT" = "PROVIDER_ERROR";
        if (msg.includes("No AI client")) code = "NO_AI_CLIENT";
        const errorEvent: GeneratePlanSSEEvent = {
          type: "error",
          code,
          message: msg,
          rawText: event.rawText,
          diagnostics: event.diagnostics,
        };
        await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(errorEvent) });
        yield errorEvent;
        await dump?.close();
        return;
      }

      case "done":
        if (!hasToolPayload) {
          const errorEvent: GeneratePlanSSEEvent = {
            type: "error",
            code: "INVALID_TOOL_PAYLOAD",
            message:
              "Provider completed without a generate_task_plan_graph tool payload.",
          };
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(errorEvent) });
          yield errorEvent;
          await dump?.close();
          return;
        }
        await dump?.write({ type: "provider_done", hasToolPayload });
        break;
    }

    if (event.type === "done") break;
  }

  if (input.signal?.aborted) {
    const event: GeneratePlanSSEEvent = { type: "cancelled" };
    await dump?.write({ type: "yield", stage: "aborted_after_provider", event });
    yield event;
    await dump?.close();
    return;
  }

  const doneEvent: GeneratePlanSSEEvent = { type: "done" };
  await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(doneEvent) });
  yield doneEvent;
  await dump?.close();
}

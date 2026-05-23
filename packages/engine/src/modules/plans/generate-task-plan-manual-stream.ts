import { db } from "@/lib/db";
import { aiGeneratePlanStream } from "@/modules/ai/runtime/ai-service";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { publishTaskWorkspaceUpdatedEvent } from "@/modules/projections/task-projection-events";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import { resolveExecutionRuntime } from "@/modules/task-execution/registry";
import { getLatestTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";
import { updateLatestCompiledPlanPrompt } from "@/modules/plan-execution/compiled-plan-store";
import { materializeGeneratedTaskPlan } from "@/modules/plans/materialize-generated-task-plan";
import type { GeneratePlanSSEEvent, PlanBlueprint } from "@chrona/contracts";
import { createDebugDump, previewDebugValue } from "@chrona/shared/debug-dump";

const PLAN_GENERATE_TOOL_NAME = "chrona_plan_generate";
const INTERNAL_PLAN_GENERATE_TOOL_NAME = "chrona.plan.generate";

function isPlanGenerateTool(tool: string | undefined): boolean {
  return tool === PLAN_GENERATE_TOOL_NAME ||
    tool === INTERNAL_PLAN_GENERATE_TOOL_NAME;
}

function isPlanBlueprint(value: Record<string, unknown>): value is PlanBlueprint {
  return typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    typeof value.goal === "string" &&
    value.goal.trim().length > 0 &&
    Array.isArray(value.nodes) &&
    value.nodes.length > 0 &&
    Array.isArray(value.edges);
}

function getToolDisplayName(tool: string | undefined) {
  switch (tool) {
    case PLAN_GENERATE_TOOL_NAME:
    case INTERNAL_PLAN_GENERATE_TOOL_NAME:
      return "generating plan structure";
    case "skill_view":
      return "reading planning skill";
    default:
      return tool ?? "AI tool";
  }
}

function getToolPreview(input: Record<string, unknown>) {
  const preview = input.preview;
  return typeof preview === "string" && preview.trim().length > 0
    ? `: ${preview}`
    : "";
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readSavedPlanAfterToolCompletion(input: {
  taskId: string;
  userInstruction?: string | null;
  signal?: AbortSignal;
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (input.signal?.aborted) return null;
    let savedPlan = await getLatestTaskPlanReadModel(input.taskId);
    if (savedPlan) {
      const userInstruction = input.userInstruction?.trim() || null;
      if (savedPlan.prompt !== userInstruction) {
        await updateLatestCompiledPlanPrompt({
          taskId: input.taskId,
          prompt: userInstruction,
        });
        savedPlan = await getLatestTaskPlanReadModel(input.taskId);
      }
      return savedPlan;
    }
    if (attempt < 4) await wait(100);
  }
  return null;
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

async function recordPlanGenerationEvent(input: {
  type: "started" | "status" | "tool_called" | "draft_saved" | "completed" | "failed" | "cancelled";
  task: { id: string; workspaceId: string };
  generationId: string;
  payload?: Record<string, unknown>;
  dedupeSuffix?: string;
}) {
  await appendCanonicalEvent({
    eventType: `plan_generation.${input.type}`,
    workspaceId: input.task.workspaceId,
    taskId: input.task.id,
    actorType: "system",
    actorId: "plan-generator",
    source: "plan_generation",
    payload: {
      generation_id: input.generationId,
      ...(input.payload ?? {}),
    },
    dedupeKey: [
      "plan_generation",
      input.task.id,
      input.generationId,
      input.type,
      input.dedupeSuffix,
    ].filter(Boolean).join(":"),
  });
  publishTaskWorkspaceUpdatedEvent({
    taskId: input.task.id,
    workspaceId: input.task.workspaceId,
    reason: `plan_generation.${input.type}`,
  });
}

async function recordPlanGenerationStatus(input: {
  task: { id: string; workspaceId: string };
  generationId: string;
  phase: string;
  message: string;
  sequence: number;
}) {
  await recordPlanGenerationEvent({
    type: "status",
    task: input.task,
    generationId: input.generationId,
    payload: {
      phase: input.phase,
      message: input.message,
      sequence: input.sequence,
    },
    dedupeSuffix: `${input.sequence}:${input.phase}`,
  });
}

/**
 * Manual plan generation stream — the only engine entry point for generating
  * a plan. Orchestrates provider streaming, waits for the Chrona MCP plan
  * generation tool to persist a plan, then emits canonical SSE events.
 *
 * No cached/saved branch — always generates fresh. No legacy compatibility shapes.
 */
export async function* generateTaskPlanManualStream(input: {
  taskId: string;
  generationId?: string;
  forceRefresh?: boolean;
  userInstruction?: string | null;
  signal?: AbortSignal;
}): AsyncGenerator<GeneratePlanSSEEvent> {
  const generationId = input.generationId ?? crypto.randomUUID();
  let planGenerationEventSequence = 0;
  const dump = await createDebugDump({
    enabledEnv: "CHRONA_AI_STREAM_DUMP",
    directoryEnv: "CHRONA_AI_STREAM_DUMP_DIR",
    kind: "ai-stream",
    label: `manual-plan-${input.taskId}`,
    meta: {
      layer: "engine.generateTaskPlanManualStream",
      taskId: input.taskId,
      generationId,
      forceRefresh: input.forceRefresh ?? false,
      hasUserInstruction: Boolean(input.userInstruction?.trim()),
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

  const userInstruction = input.userInstruction?.trim() || null;
  await recordPlanGenerationEvent({
    type: "started",
    task,
    generationId,
    payload: {
      instruction: userInstruction,
      force_refresh: input.forceRefresh ?? false,
    },
  });

  const loadingEvent: GeneratePlanSSEEvent = {
    type: "status",
    phase: "loading_task",
    message: "Loading task context...",
  };
  await recordPlanGenerationStatus({
    task,
    generationId,
    phase: loadingEvent.phase,
    message: loadingEvent.message,
    sequence: planGenerationEventSequence += 1,
  });
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

  await dump?.write({
    type: "task_context",
    taskId: task.id,
    workspaceId: task.workspaceId,
    taskSessionKey,
    estimatedMinutes: estimatedMinutes ?? null,
    hasUserInstruction: Boolean(userInstruction),
  });

  const requestingEvent: GeneratePlanSSEEvent = {
    type: "status",
    phase: "requesting_provider",
    message: "Requesting AI provider...",
  };
  await recordPlanGenerationStatus({
    task,
    generationId,
    phase: requestingEvent.phase,
    message: requestingEvent.message,
    sequence: planGenerationEventSequence += 1,
  });
  await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(requestingEvent) });
  yield requestingEvent;

  let hasPlanGenerateToolCall = false;
  let persistedPlanId: string | null = null;

  if (input.signal?.aborted) {
    const event: GeneratePlanSSEEvent = { type: "cancelled" };
    await recordPlanGenerationEvent({ type: "cancelled", task, generationId, dedupeSuffix: "before_provider" });
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
    userInstruction,
    sessionKey: taskSessionKey,
    signal: input.signal,
  })) {
    await dump?.write({
      type: "ai_event",
      event: previewDebugValue(event, 1200) as Record<string, unknown>,
    });
    if (input.signal?.aborted) {
      const cancelledEvent: GeneratePlanSSEEvent = { type: "cancelled" };
      await recordPlanGenerationEvent({ type: "cancelled", task, generationId, dedupeSuffix: "during_provider" });
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
          await recordPlanGenerationStatus({
            task,
            generationId,
            phase: statusEvent.phase,
            message: statusEvent.message,
            sequence: planGenerationEventSequence += 1,
          });
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(statusEvent) });
          yield statusEvent;
        }
        break;

      case "tool_call":
        if (isPlanGenerateTool(event.tool)) {
          hasPlanGenerateToolCall = true;
          await dump?.write({
            type: "state",
            field: "hasPlanGenerateToolCall",
            value: hasPlanGenerateToolCall,
          });

          if (isPlanBlueprint(event.input)) {
            await recordPlanGenerationEvent({
              type: "tool_called",
              task,
              generationId,
              payload: {
                tool: PLAN_GENERATE_TOOL_NAME,
                plan_title: event.input.title,
                node_count: event.input.nodes.length,
              },
            });
            if (!persistedPlanId) {
              const savedPlan = await materializeGeneratedTaskPlan({
                taskId: task.id,
                workspaceId: task.workspaceId,
                blueprint: event.input,
                generatedBy: "hermes",
                userInstruction,
              });
              persistedPlanId = savedPlan.id;
              await recordPlanGenerationEvent({
                type: "draft_saved",
                task,
                generationId,
                payload: {
                  plan_id: savedPlan.id,
                  plan_title: event.input.title,
                  node_count: event.input.nodes.length,
                },
              });
              await dump?.write({
                type: "state",
                field: "persistedPlanId",
                value: persistedPlanId,
              });
            }

            const toolEvent: GeneratePlanSSEEvent = {
              type: "tool_call",
              tool: PLAN_GENERATE_TOOL_NAME,
              input: event.input,
            };
            await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(toolEvent) });
            yield toolEvent;
          } else {
            const statusEvent: GeneratePlanSSEEvent = {
              type: "status",
              phase: "streaming",
              message: `Using ${getToolDisplayName(event.tool)}${getToolPreview(event.input)}...`,
            };
            await recordPlanGenerationStatus({
              task,
              generationId,
              phase: statusEvent.phase,
              message: statusEvent.message,
              sequence: planGenerationEventSequence += 1,
            });
            await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(statusEvent) });
            yield statusEvent;
          }
        } else {
          const statusEvent: GeneratePlanSSEEvent = {
            type: "status",
            phase: "streaming",
            message: `Using ${getToolDisplayName(event.tool)}${getToolPreview(event.input)}...`,
          };
          await recordPlanGenerationStatus({
            task,
            generationId,
            phase: statusEvent.phase,
            message: statusEvent.message,
            sequence: planGenerationEventSequence += 1,
          });
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(statusEvent) });
          yield statusEvent;
        }
        break;

      case "tool_result":
        if (isPlanGenerateTool(event.tool)) {
          if (event.error) {
            const errorEvent: GeneratePlanSSEEvent = {
              type: "error",
              code: "PROVIDER_ERROR",
              message: `${PLAN_GENERATE_TOOL_NAME} failed: ${event.result}`,
            };
            await recordPlanGenerationEvent({
              type: "failed",
              task,
              generationId,
              payload: { code: errorEvent.code, message: errorEvent.message },
              dedupeSuffix: errorEvent.code,
            });
            await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(errorEvent) });
            yield errorEvent;
            await dump?.close();
            return;
          }

          const savingEvent: GeneratePlanSSEEvent = {
            type: "status",
            phase: "saving",
            message: "Reading saved plan...",
          };
          await recordPlanGenerationStatus({
            task,
            generationId,
            phase: savingEvent.phase,
            message: savingEvent.message,
            sequence: planGenerationEventSequence += 1,
          });
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(savingEvent) });
          yield savingEvent;

          const savedPlan = await readSavedPlanAfterToolCompletion({
            taskId: task.id,
            userInstruction,
            signal: input.signal,
          });

          if (!savedPlan) {
            const errorEvent: GeneratePlanSSEEvent = {
              type: "error",
              code: "INTERNAL_ERROR",
              message: `${PLAN_GENERATE_TOOL_NAME} completed but no saved plan was found.`,
            };
            await recordPlanGenerationEvent({
              type: "failed",
              task,
              generationId,
              payload: { code: errorEvent.code, message: errorEvent.message },
              dedupeSuffix: errorEvent.code,
            });
            await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(errorEvent) });
            yield errorEvent;
            await dump?.close();
            return;
          }

          const completedEvent: GeneratePlanSSEEvent = {
            type: "status",
            phase: "completed",
            message: "Plan generated.",
          };
          const resultEvent: GeneratePlanSSEEvent = {
            type: "result",
            result: savedPlan,
            taskSessionKey,
          };
          const doneEvent: GeneratePlanSSEEvent = { type: "done" };
          await recordPlanGenerationEvent({
            type: "completed",
            task,
            generationId,
            payload: {
              plan_id: savedPlan.id,
              plan_title: savedPlan.summary,
              status: savedPlan.status,
            },
          });
          await dump?.write({ type: "saved_plan", result: previewDebugValue(savedPlan, 1200) });
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(completedEvent) });
          yield completedEvent;
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(resultEvent) });
          yield resultEvent;
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(doneEvent) });
          yield doneEvent;
          await dump?.close();
          return;
        }
        {
          const statusEvent: GeneratePlanSSEEvent = {
            type: "status",
            phase: "streaming",
            message: `${getToolDisplayName(event.tool)} completed.`,
          };
          await recordPlanGenerationStatus({
            task,
            generationId,
            phase: statusEvent.phase,
            message: statusEvent.message,
            sequence: planGenerationEventSequence += 1,
          });
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
        await recordPlanGenerationEvent({
          type: "failed",
          task,
          generationId,
          payload: { code, message: msg },
          dedupeSuffix: code,
        });
        await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(errorEvent) });
        yield errorEvent;
        await dump?.close();
        return;
      }

      case "done":
        if (!hasPlanGenerateToolCall) {
          const errorEvent: GeneratePlanSSEEvent = {
            type: "error",
            code: "INVALID_TOOL_PAYLOAD",
            message:
              `Provider completed without calling ${PLAN_GENERATE_TOOL_NAME}.`,
          };
          await recordPlanGenerationEvent({
            type: "failed",
            task,
            generationId,
            payload: { code: errorEvent.code, message: errorEvent.message },
            dedupeSuffix: errorEvent.code,
          });
          await dump?.write({ type: "yield", event: summarizeGeneratePlanEvent(errorEvent) });
          yield errorEvent;
          await dump?.close();
          return;
        }
        await dump?.write({ type: "provider_done", hasPlanGenerateToolCall });
        break;
    }

    if (event.type === "done") break;
  }

  if (input.signal?.aborted) {
    const event: GeneratePlanSSEEvent = { type: "cancelled" };
    await recordPlanGenerationEvent({ type: "cancelled", task, generationId, dedupeSuffix: "after_provider" });
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

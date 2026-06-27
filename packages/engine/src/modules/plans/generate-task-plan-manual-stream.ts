import { db } from "@/lib/db";
import { aiGeneratePlanStream } from "@/modules/ai";
import { appendCanonicalEvent } from "@/modules/events";
import { ensurePlanGenerationTaskSession, ensureWorkBlockPlanTaskSession, resolveExecutionRuntime } from "@/modules/execution-runtime";
import { getLatestTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";
import { updateLatestCompiledPlanPrompt } from "@/modules/plan-execution/persistence/compiled-plan-store";
import { materializeGeneratedTaskPlan } from "@/modules/plans/materialize-generated-task-plan";
import type { GeneratePlanSSEEvent, PlanBlueprint, TaskPlanReadModel } from "@chrona/contracts/ai";

const PLAN_GENERATE_TOOL_NAME = "chrona_plan_generate";
const INTERNAL_PLAN_GENERATE_TOOL_NAME = "chrona.plan.generate";
const CLAUDE_CODE_PLAN_GENERATE_TOOL_NAME = "mcp__chrona__chrona_plan_generate";

function isPlanGenerateTool(tool: string | undefined): boolean {
  return tool === PLAN_GENERATE_TOOL_NAME ||
    tool === INTERNAL_PLAN_GENERATE_TOOL_NAME ||
    tool === CLAUDE_CODE_PLAN_GENERATE_TOOL_NAME;
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
    case undefined:
      return tool ?? "AI tool";
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
  workBlockId?: string | null;
  userInstruction?: string | null;
  signal?: AbortSignal;
}) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (input.signal?.aborted) return null;

    const savedPlan = await getLatestTaskPlanReadModel(input.taskId, input.workBlockId ?? null);

    if (savedPlan) {
      const userInstruction = input.userInstruction?.trim() || null;
      if (savedPlan.prompt !== userInstruction) {
        await updateLatestCompiledPlanPrompt({
          taskId: input.taskId,
          workBlockId: input.workBlockId ?? null,
          prompt: userInstruction,
        });
      }
      return savedPlan;
    }
    if (attempt < 9) await wait(100);
  }
  return null;
}



async function recordPlanGenerationEvent(input: {
  type: "started" | "status" | "tool_called" | "draft_saved" | "completed" | "failed" | "cancelled";
  task: { id: string; workspaceId: string };
  workBlockId?: string | null;
  generationId: string;
  payload?: Record<string, unknown>;
  dedupeSuffix?: string;
}) {
  await appendCanonicalEvent({
    eventType: `plan_generation.${input.type}`,
    workspaceId: input.task.workspaceId,
    taskId: input.task.id,
    workBlockId: input.workBlockId ?? null,
    actorType: "system",
    actorId: "plan-generator",
    source: "plan_generation",
    payload: {
      generation_id: input.generationId,
      ...(input.payload ?? {}),
    },
    occurredAt: new Date(),
    dedupeKey: [
      "plan_generation",
      input.task.id,
      input.generationId,
      input.type,
      input.dedupeSuffix,
    ].filter(Boolean).join(":"),
  });
  // Workspace-level `task_workspace_updated` is broadcast by the route
  // handler (work.routes plan.generate) on stream finish, not here. The
  // canonical event log row is enough for activity-feed hydration; the
  // route owns the single terminal workspace update.
}

async function recordPlanGenerationStatus(input: {
  task: { id: string; workspaceId: string };
  generationId: string;
  phase: string;
  message: string;
  workBlockId?: string | null;
  sequence: number;
}) {
  await recordPlanGenerationEvent({ workBlockId: input.workBlockId,
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


async function* yieldPlanCompletion(
  savedPlan: TaskPlanReadModel,
  taskSessionKey: string,
  task: { id: string; workspaceId: string },
  generationId: string,
  workBlockId: string | null,
): AsyncGenerator<GeneratePlanSSEEvent> {
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
    workBlockId,
    type: "completed",
    task,
    generationId,
    payload: {
      plan_id: savedPlan.id,
      plan_title: savedPlan.summary,
      status: savedPlan.status,
    },
  });
  yield completedEvent;
  yield resultEvent;
  yield doneEvent;
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
  workBlockId?: string | null;
  generationId?: string;
  forceRefresh?: boolean;
  userInstruction?: string | null;
  signal?: AbortSignal;
}): AsyncGenerator<GeneratePlanSSEEvent> {
  const generationId = input.generationId ?? crypto.randomUUID();
  let planGenerationEventSequence = 0;

  const task = await db.task.findUnique({
    where: { id: input.taskId },
    include: {
      workBlocks: {
        where: input.workBlockId
          ? { id: input.workBlockId }
          : { status: { in: ["Scheduled", "Active"] } },
        orderBy: { scheduledStartAt: "asc" },
        take: 1,
      },
      importedCalendarEvents: {
        orderBy: { startsAt: "asc" },
        take: 1,
        select: { description: true },
      },
    },
  });

  if (!task) {
    const event: GeneratePlanSSEEvent = {
      type: "error",
      code: "TASK_NOT_FOUND",
      message: "Task not found",
    };
    yield event;
    return;
  }

  const userInstruction = input.userInstruction?.trim() || null;
  const currentWorkBlock = task.workBlocks[0] ?? null;
  const effectiveWorkBlockId = input.workBlockId ?? currentWorkBlock?.id ?? null;
  await recordPlanGenerationEvent({ workBlockId: effectiveWorkBlockId,
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
  await recordPlanGenerationStatus({ workBlockId: effectiveWorkBlockId,
    task,
    generationId,
    phase: loadingEvent.phase,
    message: loadingEvent.message,
    sequence: planGenerationEventSequence += 1,
  });
  yield loadingEvent;

  const runtimeName = resolveExecutionRuntime({
    executionRuntime: task.executionRuntime,
  });
  const taskSessionKey = currentWorkBlock
    ? (await ensureWorkBlockPlanTaskSession({
        taskId: task.id,
        taskTitle: task.title,
        runtimeName,
        workBlockId: currentWorkBlock.id,
        label: `${task.title} · Work block plan generation session`,
      })).sessionKey
    : (await ensurePlanGenerationTaskSession({
        taskId: task.id,
        taskTitle: task.title,
        runtimeName,
        label: `${task.title} · Plan generation session`,
      })).sessionKey;
  const estimatedMinutes =
    currentWorkBlock?.scheduledStartAt && currentWorkBlock.scheduledEndAt
      ? Math.round(
          (currentWorkBlock.scheduledEndAt.getTime() -
            currentWorkBlock.scheduledStartAt.getTime()) /
            60000,
        )
      : undefined;


  const requestingEvent: GeneratePlanSSEEvent = {
    type: "status",
    phase: "requesting_provider",
    message: "Requesting AI provider...",
  };
  await recordPlanGenerationStatus({ workBlockId: effectiveWorkBlockId,
    task,
    generationId,
    phase: requestingEvent.phase,
    message: requestingEvent.message,
    sequence: planGenerationEventSequence += 1,
  });
  yield requestingEvent;

  let hasPlanGenerateToolCall = false;
  let persistedPlanId: string | null = null;
  let materializedPlan: TaskPlanReadModel | null = null;

  if (input.signal?.aborted) {
    const event: GeneratePlanSSEEvent = { type: "cancelled" };
    await recordPlanGenerationEvent({ workBlockId: effectiveWorkBlockId, type: "cancelled", task, generationId, dedupeSuffix: "before_provider" });
    yield event;
    return;
  }

  for await (const event of aiGeneratePlanStream({
    taskId: task.id,
    title: task.title,
    description: task.description ?? undefined,
    sourceContext: task.importedCalendarEvents[0]?.description ?? undefined,
    estimatedMinutes,
    userInstruction,
    sessionKey: taskSessionKey,
    signal: input.signal,
  })) {
    if (input.signal?.aborted) {
      const cancelledEvent: GeneratePlanSSEEvent = { type: "cancelled" };
      await recordPlanGenerationEvent({ workBlockId: effectiveWorkBlockId, type: "cancelled", task, generationId, dedupeSuffix: "during_provider" });
      yield cancelledEvent;
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
          await recordPlanGenerationStatus({ workBlockId: effectiveWorkBlockId,
            task,
            generationId,
            phase: statusEvent.phase,
            message: statusEvent.message,
            sequence: planGenerationEventSequence += 1,
          });
          yield statusEvent;
        }
        break;

      case "tool_call":
        if (isPlanGenerateTool(event.tool)) {
          hasPlanGenerateToolCall = true;

          if (isPlanBlueprint(event.input)) {
            await recordPlanGenerationEvent({ workBlockId: effectiveWorkBlockId,
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
                workBlockId: effectiveWorkBlockId,
                blueprint: event.input,
                generatedBy: "hermes",
                userInstruction,
              });
              materializedPlan = savedPlan;
              persistedPlanId = savedPlan.id;
              await recordPlanGenerationEvent({ workBlockId: effectiveWorkBlockId,
                type: "draft_saved",
                task,
                generationId,
                payload: {
                  plan_id: savedPlan.id,
                  plan_title: event.input.title,
                  node_count: event.input.nodes.length,
                },
              });
            }

            const toolEvent: GeneratePlanSSEEvent = {
              type: "tool_call",
              tool: PLAN_GENERATE_TOOL_NAME,
              input: event.input,
            };
            yield toolEvent;
          } else {
            const statusEvent: GeneratePlanSSEEvent = {
              type: "status",
              phase: "streaming",
              message: `Using ${getToolDisplayName(event.tool)}${getToolPreview(event.input)}...`,
            };
            await recordPlanGenerationStatus({ workBlockId: effectiveWorkBlockId,
              task,
              generationId,
              phase: statusEvent.phase,
              message: statusEvent.message,
              sequence: planGenerationEventSequence += 1,
            });
            yield statusEvent;
          }
        } else {
          const statusEvent: GeneratePlanSSEEvent = {
            type: "status",
            phase: "streaming",
            message: `Using ${getToolDisplayName(event.tool)}${getToolPreview(event.input)}...`,
          };
          await recordPlanGenerationStatus({ workBlockId: effectiveWorkBlockId,
            task,
            generationId,
            phase: statusEvent.phase,
            message: statusEvent.message,
            sequence: planGenerationEventSequence += 1,
          });
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
              workBlockId: effectiveWorkBlockId,
              type: "failed",
              task,
              generationId,
              payload: { code: errorEvent.code, message: errorEvent.message },
              dedupeSuffix: errorEvent.code,
            });
            yield errorEvent;
            return;
          }

          const savingEvent: GeneratePlanSSEEvent = {
            type: "status",
            phase: "saving",
            message: "Reading saved plan...",
          };
          await recordPlanGenerationStatus({
            workBlockId: effectiveWorkBlockId,
            task,
            generationId,
            phase: savingEvent.phase,
            message: savingEvent.message,
            sequence: planGenerationEventSequence += 1,
          });
          yield savingEvent;
          const savedPlan = materializedPlan ?? await readSavedPlanAfterToolCompletion({
            taskId: task.id,
            userInstruction,
            workBlockId: effectiveWorkBlockId,
            signal: input.signal,
          });

          if (!savedPlan) {
            const errorEvent: GeneratePlanSSEEvent = {
              type: "error",
              code: "INTERNAL_ERROR",
              message: `${PLAN_GENERATE_TOOL_NAME} completed but no saved plan was found.`,
            };
            await recordPlanGenerationEvent({
              workBlockId: effectiveWorkBlockId,
              type: "failed",
              task,
              generationId,
              payload: { code: errorEvent.code, message: errorEvent.message },
              dedupeSuffix: errorEvent.code,
            });
            yield errorEvent;
            return;
          }

          yield* yieldPlanCompletion(savedPlan, taskSessionKey, task, generationId, effectiveWorkBlockId);
          return;
        }
        {
          const statusEvent: GeneratePlanSSEEvent = {
            type: "status",
            phase: "streaming",
            message: `${getToolDisplayName(event.tool)} completed.`,
          };
          await recordPlanGenerationStatus({
            workBlockId: effectiveWorkBlockId,
            task,
            generationId,
            phase: statusEvent.phase,
            message: statusEvent.message,
            sequence: planGenerationEventSequence += 1,
          });
          yield statusEvent;
        }
        break;

      case "partial":
        {
          const partialEvent: GeneratePlanSSEEvent = { type: "partial", text: event.text };
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
        await recordPlanGenerationEvent({ workBlockId: effectiveWorkBlockId,
          type: "failed",
          task,
          generationId,
          payload: { code, message: msg },
          dedupeSuffix: code,
        });
        yield errorEvent;
        return;
      }

      case "done":
        {
          const savedPlan = materializedPlan ?? (await getLatestTaskPlanReadModel(task.id, effectiveWorkBlockId));
          if (savedPlan) {
            yield* yieldPlanCompletion(savedPlan, taskSessionKey, task, generationId, effectiveWorkBlockId);
            return;
          }

          const message = hasPlanGenerateToolCall
            ? "Plan generation tool was called but no saved plan was found."
            : `Provider completed without calling ${PLAN_GENERATE_TOOL_NAME}.`;
          const errorEvent: GeneratePlanSSEEvent = {
            type: "error",
            code: hasPlanGenerateToolCall ? "INTERNAL_ERROR" : "INVALID_TOOL_PAYLOAD",
            message,
          };
          await recordPlanGenerationEvent({ workBlockId: effectiveWorkBlockId,
            type: "failed",
            task,
            generationId,
            payload: { code: errorEvent.code, message: errorEvent.message },
            dedupeSuffix: errorEvent.code,
          });
          yield errorEvent;
          return;
        }
      case "result":
        break;
    }

    if (input.signal?.aborted) {
      const event: GeneratePlanSSEEvent = { type: "cancelled" };
      await recordPlanGenerationEvent({ workBlockId: effectiveWorkBlockId, type: "cancelled", task, generationId, dedupeSuffix: "after_provider" });
      yield event;
      return;
    }

  }

  const doneEvent: GeneratePlanSSEEvent = { type: "done" };
  yield doneEvent;
}

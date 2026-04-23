import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiGeneratePlan, aiGeneratePlanStream } from "@/modules/ai/ai-service";
import { createLogger, summarizeText } from "@/lib/logger";
import {
  getLatestTaskPlanGraph,
  saveTaskPlanGraph,
} from "@/modules/tasks/task-plan-graph-store";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import type { TaskPlanGraph, TaskPlanGraphResponse, TaskPlanStatus } from "@/modules/ai/types";
import type { GenerateTaskPlanResponse } from "@chrona/ai-features/core/types";

const logger = createLogger("api.ai.generate-task-plan");

function buildSavedPlanSummary(savedPlan: {
  id: string;
  status: TaskPlanStatus;
  prompt: string | null;
  revision: number;
  summary: string | null;
  updatedAt: string;
}) {
  return {
    id: savedPlan.id,
    status: savedPlan.status,
    prompt: savedPlan.prompt,
    revision: savedPlan.revision,
    summary: savedPlan.summary,
    updatedAt: savedPlan.updatedAt,
  };
}

function buildDraftPlanGraph(input: {
  taskId: string;
  prompt: string | null;
  generatedBy: string;
  planResult: GenerateTaskPlanResponse;
}) {
  const now = new Date().toISOString();
  return {
    id: `graph-${input.taskId || "adhoc"}-${Date.now()}`,
    taskId: input.taskId,
    status: "draft",
    revision: 1,
    source: "ai",
    generatedBy: input.generatedBy,
    prompt: input.prompt,
    summary: input.planResult.summary,
    changeSummary: null,
    createdAt: now,
    updatedAt: now,
    nodes: input.planResult.nodes,
    edges: input.planResult.edges,
  } satisfies TaskPlanGraph;
}

function buildPlanResponse(input: {
  source: string;
  planGraph: TaskPlanGraph;
  taskSessionKey?: string | null;
  savedPlan?: {
    id: string;
    status: TaskPlanStatus;
    prompt: string | null;
    revision: number;
    summary: string | null;
    updatedAt: string;
  };
  reasoning?: string;
}): TaskPlanGraphResponse & { reasoning?: string } {
  return {
    source: input.source,
    planGraph: input.planGraph,
    taskSessionKey: input.taskSessionKey ?? null,
    savedPlan: input.savedPlan,
    reasoning: input.reasoning,
  };
}

function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      taskId,
      title,
      description,
      priority: _priority,
      dueAt: _dueAt,
      estimatedMinutes,
      planningPrompt,
      forceRefresh = false,
    } = body;

    if (!taskId && !title) {
      return NextResponse.json(
        { error: "Either taskId or title is required" },
        { status: 400 },
      );
    }

    const wantsStream = (request.headers.get("accept") ?? "").includes("text/event-stream");
    const requestId = crypto.randomUUID();
    logger.info("request.start", {
      requestId,
      feature: "generate_plan",
      taskId: taskId ?? null,
      title: summarizeText(title ?? null),
      streaming: wantsStream,
      forceRefresh,
    });

    if (taskId && !forceRefresh) {
      const savedPlan = await getLatestTaskPlanGraph(taskId);
      if (savedPlan) {
        if (wantsStream) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sseEncode("result", buildPlanResponse({
                source: "saved",
                planGraph: savedPlan.plan,
                taskSessionKey: sharedTaskSessionKey,
                savedPlan: buildSavedPlanSummary(savedPlan),
              }))));
              controller.enqueue(encoder.encode(sseEncode("done", {})));
              controller.close();
            },
          });
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }
        return NextResponse.json(buildPlanResponse({
          source: "saved",
          planGraph: savedPlan.plan,
          savedPlan: buildSavedPlanSummary(savedPlan),
        }));
      }
    }

    let resolvedWorkspaceId: string | null = null;
    let resolvedTitle = title;
    let resolvedDescription = description;
    let resolvedEstimatedMinutes = estimatedMinutes;

    let sharedTaskSessionKey: string | null = null;

    if (taskId) {
      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }
      resolvedWorkspaceId = task.workspaceId;
      resolvedTitle = task.title;
      resolvedDescription = task.description ?? undefined;
      if (task.scheduledStartAt && task.scheduledEndAt) {
        resolvedEstimatedMinutes = Math.round(
          (task.scheduledEndAt.getTime() - task.scheduledStartAt.getTime()) / 60000,
        );
      }
      sharedTaskSessionKey = (
        await ensureDefaultTaskSession({
          taskId: task.id,
          taskTitle: task.title,
          runtimeName: "openclaw",
          defaultSessionId: task.defaultSessionId,
        })
      ).sessionKey;
    }

    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let finalResponse: (TaskPlanGraphResponse & { reasoning?: string }) | null = null;
          try {
            const eventCounts: Record<string, number> = {};
            let streamClosed = false;
            let requestFinished = false;

            const safeEnqueue = (event: string, data: unknown) => {
              if (streamClosed || requestFinished) {
                return false;
              }
              try {
                controller.enqueue(encoder.encode(sseEncode(event, data)));
                return true;
              } catch {
                streamClosed = true;
                return false;
              }
            };

            const safeClose = () => {
              if (streamClosed) return;
              try {
                controller.close();
              } catch {
                // ignore double-close / cancelled stream
              } finally {
                streamClosed = true;
              }
            };

            for await (const event of aiGeneratePlanStream({
              taskId: taskId ?? "",
              title: resolvedTitle,
              description: resolvedDescription,
              estimatedMinutes: resolvedEstimatedMinutes,
            })) {
              if (streamClosed || requestFinished) {
                break;
              }
              eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
              logger.info("stream.event", {
                requestId,
                feature: "generate_plan",
                taskId: taskId ?? null,
                eventType: event.type,
              });
              if (event.type === "status") {
                if (!safeEnqueue("status", { message: event.message })) break;
              } else if (event.type === "tool_call") {
                if (!safeEnqueue("tool_call", { tool: event.tool, input: event.input })) break;
              } else if (event.type === "tool_result") {
                if (!safeEnqueue("tool_result", { tool: event.tool, result: event.result })) break;
              } else if (event.type === "partial") {
                if (!safeEnqueue("partial", { text: event.text })) break;
              } else if (event.type === "result") {
                if (!("plan" in event)) {
                  continue;
                }
                const draftPlan = buildDraftPlanGraph({
                  taskId: taskId ?? "",
                  prompt: planningPrompt ?? null,
                  generatedBy: event.plan.source ?? "ai",
                  planResult: event.plan,
                });

                if (taskId && resolvedWorkspaceId) {
                  const savedPlan = await saveTaskPlanGraph({
                    workspaceId: resolvedWorkspaceId,
                    taskId,
                    plan: draftPlan,
                    prompt: planningPrompt ?? null,
                    status: "draft",
                    source: "ai",
                    generatedBy: event.plan.source ?? "ai",
                    summary: event.plan.summary,
                  });
                  finalResponse = buildPlanResponse({
                    source: event.plan.source,
                    planGraph: savedPlan.plan,
                    taskSessionKey: sharedTaskSessionKey,
                    savedPlan: buildSavedPlanSummary(savedPlan),
                    reasoning: event.plan.reasoning,
                  });
                } else {
                  finalResponse = buildPlanResponse({
                    source: event.plan.source,
                    planGraph: draftPlan,
                    taskSessionKey: sharedTaskSessionKey,
                    reasoning: event.plan.reasoning,
                  });
                }
                if (!safeEnqueue("result", finalResponse)) break;
              } else if (event.type === "error") {
                if (!safeEnqueue("error", { message: event.message })) break;
                requestFinished = true;
                break;
              } else if (event.type === "done") {
                logger.info("request.done", {
                  requestId,
                  feature: "generate_plan",
                  taskId: taskId ?? null,
                  eventCounts,
                  savedPlanId: finalResponse?.savedPlan?.id ?? null,
                });
                if (!safeEnqueue("done", { response: finalResponse })) break;
                requestFinished = true;
                break;
              }
            }
            safeClose();
          } catch (error) {
            logger.error("request.stream_error", {
              requestId,
              feature: "generate_plan",
              taskId: taskId ?? null,
              error: error instanceof Error ? error.message : String(error),
            });
            try {
              controller.enqueue(
                encoder.encode(
                  sseEncode("error", {
                    message: error instanceof Error ? error.message : "Failed to generate task plan",
                  }),
                ),
              );
            } catch {
              // stream already closed/cancelled
            }
            try {
              controller.close();
            } catch {
              // ignore double-close / cancelled stream
            }
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const planResult = await aiGeneratePlan({
      taskId: taskId ?? "",
      title: resolvedTitle,
      description: resolvedDescription,
      estimatedMinutes: resolvedEstimatedMinutes,
    });

    logger.info("request.blocking_result", {
      requestId,
      feature: "generate_plan",
      taskId: taskId ?? null,
      title: summarizeText(resolvedTitle),
      hasPlan: Boolean(planResult),
    });

    if (!planResult) {
      return NextResponse.json(
        { error: "AI planning unavailable" },
        { status: 503 },
      );
    }

    const plan = buildDraftPlanGraph({
      taskId: taskId ?? "",
      prompt: planningPrompt ?? null,
      generatedBy: planResult.source ?? "ai",
      planResult,
    });

    if (taskId && resolvedWorkspaceId) {
      const savedPlan = await saveTaskPlanGraph({
        workspaceId: resolvedWorkspaceId,
        taskId,
        plan,
        prompt: planningPrompt ?? null,
        status: "draft",
        source: "ai",
        generatedBy: planResult.source ?? "ai",
        summary: planResult.summary,
      });

      return NextResponse.json(buildPlanResponse({
        source: planResult.source,
        planGraph: savedPlan.plan,
        taskSessionKey: sharedTaskSessionKey,
        savedPlan: buildSavedPlanSummary(savedPlan),
        reasoning: planResult.reasoning,
      }));
    }

    return NextResponse.json(buildPlanResponse({
      source: planResult.source,
      planGraph: plan,
      taskSessionKey: sharedTaskSessionKey,
      reasoning: planResult.reasoning,
    }));
  } catch (error) {
    logger.error("request.error", {
      feature: "generate_plan",
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to generate task plan" },
      { status: 500 },
    );
  }
}


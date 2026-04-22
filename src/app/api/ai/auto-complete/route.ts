import { randomUUID } from "node:crypto";
import { aiSuggestStream } from "@/modules/ai/ai-service";
import type { TaskSnapshot, ScheduleHealthSnapshot } from "@/modules/ai/ai-service";
import { db } from "@/lib/db";
import type { StructuredSuggestion } from "@/hooks/use-ai";
import { createLogger, summarizeText } from "@/lib/logger";

// Re-export for consumers of this route
export type { StructuredSuggestion };

const logger = createLogger("api.ai.auto-complete");

export interface AutoCompleteAPIResponse {
  suggestions: StructuredSuggestion[];
  source: string;
  requestId: string;
}

function generateSummary(s: { title: string; priority: string; estimatedMinutes: number }): string {
  const priorityMap: Record<string, string> = {
    Low: "低优先级",
    Medium: "中优先级",
    High: "高优先级",
    Urgent: "紧急",
  };
  return `创建${s.estimatedMinutes}分钟的「${s.title}」任务，${priorityMap[s.priority] ?? s.priority}`;
}

// ────────────────────────────────────────────────────────────────────
// JSON extraction from LLM output
// ────────────────────────────────────────────────────────────────────

function normalizeSuggestionShape(parsed: unknown): StructuredSuggestion[] | null {
  if (!parsed || typeof parsed !== "object") return null;

  const envelope = parsed as {
    suggestions?: Array<{
      title?: string;
      description?: string;
      priority?: string;
      estimatedMinutes?: number;
      tags?: string[];
      suggestedSlot?: { startAt: string; endAt: string };
    }>;
    result?: {
      suggestions?: Array<{
        title?: string;
        description?: string;
        priority?: string;
        estimatedMinutes?: number;
        tags?: string[];
        suggestedSlot?: { startAt: string; endAt: string };
      }>;
    };
  };

  const suggestions = envelope.suggestions ?? envelope.result?.suggestions;
  if (!suggestions || !Array.isArray(suggestions)) return null;

  return suggestions
    .filter((s) => s.title)
    .map((s) => ({
      id: randomUUID(),
      summary: generateSummary({
        title: s.title!,
        priority: s.priority ?? "Medium",
        estimatedMinutes: s.estimatedMinutes ?? 30,
      }),
      action: {
        type: "create_task" as const,
        title: s.title!,
        description: s.description ?? "",
        priority: (s.priority ?? "Medium") as "Low" | "Medium" | "High" | "Urgent",
        estimatedMinutes: s.estimatedMinutes ?? 30,
        tags: s.tags ?? [],
        scheduledStartAt: s.suggestedSlot?.startAt,
        scheduledEndAt: s.suggestedSlot?.endAt,
      },
    }));
}

function tryExtractSuggestions(text: string): StructuredSuggestion[] | null {
  const jsonMatch =
    text.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? text;
  try {
    const parsed = JSON.parse(jsonStr.trim()) as unknown;
    return normalizeSuggestionShape(parsed);
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// SSE helper
// ────────────────────────────────────────────────────────────────────

function sseEncode(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ────────────────────────────────────────────────────────────────────
// Route handler — SSE streaming
// ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, workspaceId } = body;

    if (!title || typeof title !== "string" || title.trim().length < 2) {
      return new Response(JSON.stringify({ error: "title is required (min 2 characters)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const trimmedTitle = title.trim();
    const requestId = randomUUID();
    logger.info("request.start", {
      requestId,
      workspaceId: workspaceId ?? null,
      feature: "suggest",
      rawInput: summarizeText(title),
      normalizedInput: summarizeText(trimmedTitle),
      source: "schedule_quick_create",
      streaming: true,
    });

    // Build context
    let context: { existingTasks?: TaskSnapshot[]; scheduleHealth?: ScheduleHealthSnapshot } | undefined;
    if (workspaceId) {
      try {
        const recentTasks = await db.taskProjection.findMany({
          where: { workspaceId },
          take: 10,
          orderBy: { updatedAt: "desc" },
          include: { task: { select: { title: true, status: true, priority: true } } },
        });
        context = {
          existingTasks: recentTasks.map((p) => ({
            id: p.taskId,
            title: p.task?.title ?? "",
            status: p.task?.status ?? "open",
            priority: p.task?.priority ?? undefined,
            scheduledStartAt: p.scheduledStartAt?.toISOString(),
            scheduledEndAt: p.scheduledEndAt?.toISOString(),
          })),
        };
      } catch {
        // Non-critical
      }
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Stream AI suggestions
          let fullText = "";
          const eventCounts: Record<string, number> = {};
          const gen = aiSuggestStream({
            input: trimmedTitle,
            kind: "auto-complete",
            workspaceId,
            context,
          });

          for await (const event of gen) {
            eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
            logger.info("stream.event", {
              requestId,
              workspaceId: workspaceId ?? null,
              feature: "suggest",
              eventType: event.type,
            });
            switch (event.type) {
              case "status":
                controller.enqueue(
                  encoder.encode(sseEncode("status", { message: event.message })),
                );
                break;
              case "tool_call":
                controller.enqueue(
                  encoder.encode(sseEncode("tool_call", { tool: event.tool, input: event.input })),
                );
                break;
              case "tool_result":
                controller.enqueue(
                  encoder.encode(sseEncode("tool_result", { tool: event.tool, result: event.result })),
                );
                break;
              case "partial":
                fullText += event.text;
                controller.enqueue(
                  encoder.encode(sseEncode("partial", { text: event.text })),
                );
                break;
              case "result": {
                const aiSuggestions = event.suggestions?.suggestions?.map((suggestion) => ({
                  id: randomUUID(),
                  summary: generateSummary({
                    title: suggestion.title,
                    priority: suggestion.priority,
                    estimatedMinutes: suggestion.estimatedMinutes,
                  }),
                  action: {
                    type: "create_task" as const,
                    title: suggestion.title,
                    description: suggestion.description,
                    priority: suggestion.priority,
                    estimatedMinutes: suggestion.estimatedMinutes,
                    tags: suggestion.tags,
                    scheduledStartAt: suggestion.suggestedSlot?.startAt,
                    scheduledEndAt: suggestion.suggestedSlot?.endAt,
                  },
                })) ?? [];

                if (aiSuggestions.length > 0) {
                  controller.enqueue(
                    encoder.encode(sseEncode("suggestions", {
                      suggestions: aiSuggestions,
                      source: event.suggestions?.source ?? "ai",
                      requestId,
                      isFinal: true,
                    })),
                  );
                  logger.info("suggestions.final", {
                    requestId,
                    workspaceId: workspaceId ?? null,
                    count: aiSuggestions.length,
                  });
                }
                break;
              }
              case "done":
                fullText = event.text;
                // Try to parse final suggestions
                const aiSuggestions = tryExtractSuggestions(fullText);
                if (aiSuggestions && aiSuggestions.length > 0) {
                  controller.enqueue(
                    encoder.encode(sseEncode("suggestions", {
                      suggestions: aiSuggestions,
                      source: "ai",
                      requestId,
                      isFinal: true,
                    })),
                  );
                }
                break;
              case "error":
                controller.enqueue(
                  encoder.encode(sseEncode("error", { message: event.message })),
                );
                break;
            }
          }

          logger.info("request.done", {
            requestId,
            workspaceId: workspaceId ?? null,
            feature: "suggest",
            eventCounts,
          });
          controller.enqueue(encoder.encode(sseEncode("done", { requestId })));
          controller.close();
        } catch (error) {
          logger.error("request.stream_error", {
            requestId,
            workspaceId: workspaceId ?? null,
            feature: "suggest",
            error: error instanceof Error ? error.message : String(error),
          });
          controller.enqueue(
            encoder.encode(sseEncode("error", {
              message: error instanceof Error ? error.message : "Unknown error",
            })),
          );
          controller.close();
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
  } catch (error) {
    logger.error("request.error", {
      feature: "suggest",
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({ error: "Failed to generate suggestions" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

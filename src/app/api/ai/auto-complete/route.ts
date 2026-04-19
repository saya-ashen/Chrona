import { randomUUID } from "node:crypto";
import { aiSuggestStream } from "@/modules/ai/ai-service";
import type { TaskSnapshot, ScheduleHealthSnapshot } from "@/modules/ai/ai-service";
import { db } from "@/lib/db";
import type { StructuredSuggestion } from "@/hooks/use-ai";

// Re-export for consumers of this route
export type { StructuredSuggestion };

export interface AutoCompleteAPIResponse {
  suggestions: StructuredSuggestion[];
  source: string;
  requestId: string;
}

// ────────────────────────────────────────────────────────────────────
// Keyword-based fallback (no AI needed)
// ────────────────────────────────────────────────────────────────────

interface KeywordRule {
  keywords: string[];
  suggestions: Array<{
    title: string;
    description: string;
    priority: "Low" | "Medium" | "High" | "Urgent";
    estimatedMinutes: number;
    tags: string[];
  }>;
}

const keywordRules: KeywordRule[] = [
  {
    keywords: ["meeting", "meet", "call", "sync", "会议", "开会", "同步"],
    suggestions: [
      { title: "Team sync meeting", description: "Regular team sync to discuss progress and blockers.", priority: "Medium", estimatedMinutes: 30, tags: ["meeting"] },
      { title: "1:1 meeting", description: "One-on-one check-in.", priority: "Medium", estimatedMinutes: 30, tags: ["meeting", "1:1"] },
    ],
  },
  {
    keywords: ["review", "pr", "code review", "审查", "评审"],
    suggestions: [
      { title: "Code review", description: "Review pull request changes and provide feedback.", priority: "High", estimatedMinutes: 45, tags: ["review", "code"] },
    ],
  },
  {
    keywords: ["write", "draft", "document", "doc", "写", "文档"],
    suggestions: [
      { title: "Write documentation", description: "Draft clear documentation.", priority: "Medium", estimatedMinutes: 60, tags: ["writing"] },
    ],
  },
  {
    keywords: ["fix", "bug", "debug", "修复", "调试"],
    suggestions: [
      { title: "Fix bug", description: "Investigate and fix the issue.", priority: "High", estimatedMinutes: 60, tags: ["bug", "fix"] },
    ],
  },
  {
    keywords: ["deploy", "release", "部署", "发布"],
    suggestions: [
      { title: "Deploy to production", description: "Prepare and execute deployment.", priority: "Urgent", estimatedMinutes: 30, tags: ["deployment"] },
    ],
  },
  {
    keywords: ["test", "testing", "测试"],
    suggestions: [
      { title: "Write tests", description: "Write unit and integration tests.", priority: "Medium", estimatedMinutes: 60, tags: ["testing"] },
    ],
  },
  {
    keywords: ["plan", "planning", "计划", "规划"],
    suggestions: [
      { title: "Sprint planning", description: "Plan tasks for the upcoming sprint.", priority: "Medium", estimatedMinutes: 60, tags: ["planning"] },
    ],
  },
  {
    keywords: ["learn", "study", "research", "学习", "研究"],
    suggestions: [
      { title: "Research topic", description: "Deep dive into the topic and take notes.", priority: "Low", estimatedMinutes: 90, tags: ["research"] },
    ],
  },
];

function generateSummary(s: { title: string; priority: string; estimatedMinutes: number }): string {
  const priorityMap: Record<string, string> = {
    Low: "低优先级",
    Medium: "中优先级",
    High: "高优先级",
    Urgent: "紧急",
  };
  return `创建${s.estimatedMinutes}分钟的「${s.title}」任务，${priorityMap[s.priority] ?? s.priority}`;
}

function ruleBasedSuggest(title: string): StructuredSuggestion[] {
  const lower = title.toLowerCase();
  const matched = keywordRules.filter((rule) =>
    rule.keywords.some((kw) => lower.includes(kw)),
  );

  const suggestions = matched.flatMap((rule) => rule.suggestions);
  if (suggestions.length === 0) return [];

  return suggestions.slice(0, 4).map((s) => ({
    id: randomUUID(),
    summary: generateSummary(s),
    action: { type: "create_task" as const, ...s },
  }));
}

// ────────────────────────────────────────────────────────────────────
// JSON extraction from LLM output
// ────────────────────────────────────────────────────────────────────

function tryExtractSuggestions(text: string): StructuredSuggestion[] | null {
  const jsonMatch =
    text.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? text;
  try {
    const parsed = JSON.parse(jsonStr.trim()) as {
      suggestions?: Array<{
        title?: string;
        description?: string;
        priority?: string;
        estimatedMinutes?: number;
        tags?: string[];
        suggestedSlot?: { startAt: string; endAt: string };
      }>;
    };
    if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) return null;
    return parsed.suggestions
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
          // Send rule-based suggestions immediately as a fast first response
          const ruleSuggestions = ruleBasedSuggest(trimmedTitle);
          if (ruleSuggestions.length > 0) {
            controller.enqueue(
              encoder.encode(sseEncode("suggestions", {
                suggestions: ruleSuggestions,
                source: "rules",
                requestId,
                isFinal: false,
              })),
            );
          }

          // Stream AI suggestions
          let fullText = "";
          const gen = aiSuggestStream({
            input: trimmedTitle,
            kind: "auto-complete",
            workspaceId,
            context,
          });

          for await (const event of gen) {
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

          // If no AI suggestions were generated, ensure we mark as final
          if (!fullText) {
            controller.enqueue(
              encoder.encode(sseEncode("suggestions", {
                suggestions: ruleSuggestions,
                source: "rules",
                requestId,
                isFinal: true,
              })),
            );
          }

          controller.enqueue(encoder.encode(sseEncode("done", { requestId })));
          controller.close();
        } catch (error) {
          console.error("Stream error:", error);
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
    console.error("Error in auto-complete:", error);
    return new Response(JSON.stringify({ error: "Failed to generate suggestions" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

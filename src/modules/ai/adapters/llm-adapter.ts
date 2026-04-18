/**
 * LLM Adapter — Wraps OpenAI-compatible chat completion endpoints.
 *
 * This adapter uses the existing llm-service.ts infrastructure to
 * provide AI features via raw LLM calls. It supports structured output
 * via JSON mode but has no tool-calling or persistent context.
 *
 * Best for: simple suggestions, task decomposition, conflict analysis
 * when no agentic runtime is available.
 */

import { AIAdapter } from "./base";
import type {
  AIAdapterCapabilities,
  AIAdapterConfig,
  AnalyzeConflictsRequest,
  AnalyzeConflictsResponse,
  ChatRequest,
  ChatResponse,
  DecomposeTaskRequest,
  DecomposeTaskResponse,
  SmartSuggestRequest,
  SmartSuggestResponse,
  SuggestTimeslotRequest,
  SuggestTimeslotResponse,
} from "./types";
import { AIAdapterError } from "./types";
import {
  chatCompletion,
  chatCompletionJSON,
  isLLMAvailable,
} from "../llm-service";

export class LLMAdapter extends AIAdapter {
  get type(): string {
    return "llm";
  }

  capabilities(): AIAdapterCapabilities {
    return {
      toolCalling: false,
      structuredOutput: true,
      streaming: false,
      persistentContext: false,
      codeExecution: false,
      sessions: false,
    };
  }

  async isAvailable(): Promise<boolean> {
    return isLLMAvailable();
  }

  // ──────────────────────────────────────────────────────────────────
  // Smart Suggest
  // ──────────────────────────────────────────────────────────────────

  async suggest(request: SmartSuggestRequest): Promise<SmartSuggestResponse> {
    const requestId = crypto.randomUUID();
    const contextLines: string[] = [];

    if (request.context?.existingTasks?.length) {
      contextLines.push(
        `Existing tasks:\n${request.context.existingTasks
          .slice(0, 10)
          .map((t) => `- ${t.title} (${t.status}, ${t.priority ?? "Medium"})`)
          .join("\n")}`,
      );
    }
    if (request.context?.scheduleHealth) {
      const h = request.context.scheduleHealth;
      contextLines.push(
        `Schedule health: ${h.totalTasks} tasks, ${h.conflictCount} conflicts, ${h.loadPercent}% load, ${h.freeMinutesToday}min free today`,
      );
    }
    if (request.context?.selectedDay) {
      contextLines.push(`Selected day: ${request.context.selectedDay}`);
    }

    const result = await chatCompletionJSON<{
      suggestions: Array<{
        title: string;
        description: string;
        priority: string;
        estimatedMinutes: number;
        tags: string[];
        suggestedSlot?: { startAt: string; endAt: string };
      }>;
    }>({
      messages: [
        {
          role: "system",
          content: `You are an intelligent calendar assistant. Given a partial task input and schedule context, suggest 2-4 complete task entries.

Rules:
- Each suggestion should be practical and actionable
- Estimate realistic durations in minutes
- Set appropriate priority (Low/Medium/High/Urgent)
- Add relevant tags
- If schedule context is available, suggest time slots that don't conflict
- Respond in the same language as the input
- Return JSON: { "suggestions": [{ "title", "description", "priority", "estimatedMinutes", "tags": [], "suggestedSlot"?: { "startAt", "endAt" } }] }`,
        },
        {
          role: "user",
          content: `Input: "${request.input}"\nKind: ${request.kind}\n${contextLines.length ? `\nContext:\n${contextLines.join("\n")}` : ""}`,
        },
      ],
      temperature: 0.7,
    });

    if (!result) {
      throw new AIAdapterError("LLM unavailable", this.type, "unavailable");
    }

    return {
      suggestions: (result.suggestions ?? []).map((s) => ({
        title: s.title,
        description: s.description ?? "",
        priority: (s.priority as SmartSuggestResponse["suggestions"][0]["priority"]) ?? "Medium",
        estimatedMinutes: s.estimatedMinutes ?? 30,
        tags: s.tags ?? [],
        suggestedSlot: s.suggestedSlot,
      })),
      source: this.type,
      requestId,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Task Decomposition
  // ──────────────────────────────────────────────────────────────────

  async decompose(
    request: DecomposeTaskRequest,
  ): Promise<DecomposeTaskResponse> {
    const result = await chatCompletionJSON<{
      subtasks: Array<{
        title: string;
        description?: string;
        estimatedMinutes?: number;
        priority?: string;
        order: number;
        dependsOn?: number[];
      }>;
      reasoning?: string;
    }>({
      messages: [
        {
          role: "system",
          content: `You are a task decomposition assistant. Break the given task into 2-8 actionable subtasks.

Return JSON:
{
  "subtasks": [{ "title", "description", "estimatedMinutes", "priority", "order", "dependsOn": [] }],
  "reasoning": "why this decomposition"
}

Rules:
- Subtasks must be specific and actionable
- Estimate realistic durations
- Mark dependencies by referring to other subtask order numbers
- Respond in the same language as the task`,
        },
        {
          role: "user",
          content: `Task: "${request.title}"${request.description ? `\nDescription: ${request.description}` : ""}${request.estimatedMinutes ? `\nEstimated: ${request.estimatedMinutes} minutes` : ""}`,
        },
      ],
      temperature: 0.5,
    });

    if (!result) {
      throw new AIAdapterError("LLM unavailable", this.type, "unavailable");
    }

    return {
      subtasks: (result.subtasks ?? []).map((s) => ({
        title: s.title,
        description: s.description,
        estimatedMinutes: s.estimatedMinutes,
        priority: s.priority as DecomposeTaskResponse["subtasks"][0]["priority"],
        order: s.order,
        dependsOn: s.dependsOn,
      })),
      reasoning: result.reasoning,
      source: this.type,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Conflict Analysis
  // ──────────────────────────────────────────────────────────────────

  async analyzeConflicts(
    request: AnalyzeConflictsRequest,
  ): Promise<AnalyzeConflictsResponse> {
    const taskList = request.tasks
      .map(
        (t) =>
          `- ${t.id}: "${t.title}" ${t.scheduledStartAt ?? "unscheduled"}~${t.scheduledEndAt ?? ""} priority=${t.priority ?? "Medium"}`,
      )
      .join("\n");

    const result = await chatCompletionJSON<{
      conflicts: Array<{
        id: string;
        type: string;
        severity: string;
        taskIds: string[];
        description: string;
        timeRange?: { start: string; end: string };
      }>;
      resolutions: Array<{
        conflictId: string;
        type: string;
        description: string;
        reason: string;
        changes: Array<{
          taskId: string;
          scheduledStartAt?: string;
          scheduledEndAt?: string;
          priority?: string;
        }>;
      }>;
      summary: string;
    }>({
      messages: [
        {
          role: "system",
          content: `You are a schedule conflict analyzer. Given a list of tasks with their schedules, identify conflicts and suggest resolutions.

Conflict types: time_overlap, overload, fragmentation, dependency
Severity: low, medium, high
Resolution types: reschedule, split, merge, defer, reorder

Return JSON:
{
  "conflicts": [{ "id", "type", "severity", "taskIds": [], "description", "timeRange"?: { "start", "end" } }],
  "resolutions": [{ "conflictId", "type", "description", "reason", "changes": [{ "taskId", "scheduledStartAt"?, "scheduledEndAt"?, "priority"? }] }],
  "summary": "overall assessment"
}`,
        },
        {
          role: "user",
          content: `Tasks:\n${taskList}${request.focusDate ? `\nFocus date: ${request.focusDate}` : ""}`,
        },
      ],
      temperature: 0.3,
    });

    if (!result) {
      throw new AIAdapterError("LLM unavailable", this.type, "unavailable");
    }

    return {
      conflicts: (result.conflicts ?? []) as AnalyzeConflictsResponse["conflicts"],
      resolutions: (result.resolutions ?? []) as AnalyzeConflictsResponse["resolutions"],
      summary: result.summary ?? "",
      source: this.type,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Timeslot Suggestion
  // ──────────────────────────────────────────────────────────────────

  async suggestTimeslots(
    request: SuggestTimeslotRequest,
  ): Promise<SuggestTimeslotResponse> {
    const scheduleList = request.currentSchedule
      .filter((t) => t.scheduledStartAt && t.scheduledEndAt)
      .map((t) => `- "${t.title}" ${t.scheduledStartAt}~${t.scheduledEndAt}`)
      .join("\n");

    const result = await chatCompletionJSON<{
      slots: Array<{
        startAt: string;
        endAt: string;
        score: number;
        reason: string;
      }>;
      reasoning?: string;
    }>({
      messages: [
        {
          role: "system",
          content: `You are a scheduling optimizer. Given a task and the current schedule, suggest the best time slots.

Return JSON:
{
  "slots": [{ "startAt": "ISO datetime", "endAt": "ISO datetime", "score": 0.0-1.0, "reason": "why" }],
  "reasoning": "overall logic"
}

Rules:
- Suggest 2-5 slots
- Avoid conflicts with existing schedule
- Score: 1.0 = perfect, 0.0 = worst
- Consider work hours (${request.preferences?.workdayStartHour ?? 9}:00-${request.preferences?.workdayEndHour ?? 18}:00)
- Include buffer time (${request.preferences?.bufferMinutes ?? 15} min) between tasks`,
        },
        {
          role: "user",
          content: `Task: "${request.taskTitle}" (${request.estimatedMinutes} min, ${request.priority ?? "Medium"} priority)${request.deadline ? `\nDeadline: ${request.deadline}` : ""}\n\nCurrent schedule:\n${scheduleList || "(empty)"}`,
        },
      ],
      temperature: 0.3,
    });

    if (!result) {
      throw new AIAdapterError("LLM unavailable", this.type, "unavailable");
    }

    return {
      slots: result.slots ?? [],
      reasoning: result.reasoning,
      source: this.type,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // General Chat
  // ──────────────────────────────────────────────────────────────────

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const result = request.jsonMode
      ? await chatCompletionJSON<unknown>({
          messages: request.messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          signal: request.signal,
        })
      : await chatCompletion({
          messages: request.messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          signal: request.signal,
        });

    if (!result) {
      throw new AIAdapterError("LLM unavailable", this.type, "unavailable");
    }

    if (request.jsonMode) {
      return {
        content: JSON.stringify(result),
        parsed: result,
        source: this.type,
      };
    }

    const chatResult = result as { content: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } };
    return {
      content: chatResult.content,
      usage: chatResult.usage,
      source: this.type,
    };
  }
}

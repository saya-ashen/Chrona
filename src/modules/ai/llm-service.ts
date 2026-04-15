/**
 * LLM Service — lightweight abstraction over OpenAI-compatible chat API.
 *
 * Supports any OpenAI-compatible endpoint (OpenAI, OpenRouter, local LLMs).
 * When AI_PROVIDER is not configured, falls back to rule-based logic
 * by returning `null` from `chatCompletion`, so callers can degrade gracefully.
 *
 * Environment variables:
 *   AI_PROVIDER_BASE_URL — e.g. https://api.openai.com/v1 or https://openrouter.ai/api/v1
 *   AI_PROVIDER_API_KEY  — API key
 *   AI_PROVIDER_MODEL    — default model, e.g. gpt-4o-mini, claude-sonnet-4-20250514
 */

// ---------- Types ----------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** If true, parse JSON from response. Returns parsed object. */
  jsonMode?: boolean;
  /** Optional AbortSignal for cancellation */
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMServiceConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

// ---------- Configuration ----------

function loadConfig(): LLMServiceConfig | null {
  const baseUrl = process.env.AI_PROVIDER_BASE_URL;
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  const defaultModel = process.env.AI_PROVIDER_MODEL ?? "gpt-4o-mini";

  if (!baseUrl || !apiKey) {
    return null;
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, defaultModel };
}

// ---------- Service ----------

export function isLLMAvailable(): boolean {
  return loadConfig() !== null;
}

/**
 * Call an OpenAI-compatible chat completion endpoint.
 * Returns null if the AI provider is not configured (callers should fall back to rules).
 */
export async function chatCompletion(
  options: ChatCompletionOptions,
): Promise<ChatCompletionResult | null> {
  const config = loadConfig();
  if (!config) {
    return null;
  }

  const model = options.model ?? config.defaultModel;
  const url = `${config.baseUrl}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
  };

  if (options.maxTokens) {
    body.max_tokens = options.maxTokens;
  }

  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(
      `LLM API error (${response.status}): ${errorText.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const content = data.choices?.[0]?.message?.content ?? "";

  return {
    content,
    model: data.model ?? model,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        }
      : undefined,
  };
}

/**
 * Helper to call LLM and parse structured JSON output.
 * Falls back to null if LLM is unavailable.
 */
export async function chatCompletionJSON<T>(
  options: ChatCompletionOptions,
): Promise<T | null> {
  const result = await chatCompletion({ ...options, jsonMode: true });
  if (!result) return null;

  try {
    return JSON.parse(result.content) as T;
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = result.content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      return JSON.parse(jsonMatch[1].trim()) as T;
    }
    throw new Error(
      `Failed to parse LLM JSON response: ${result.content.slice(0, 200)}`,
    );
  }
}

// ---------- Prompt Templates ----------

/**
 * System prompt for task decomposition.
 */
export function taskDecompositionSystemPrompt(): string {
  return `You are an intelligent task decomposition assistant for a schedule management application.
Given a task with its title, description, priority, and optional due date, break it down into actionable subtasks.

Rules:
1. Each subtask should be specific and actionable
2. Estimate time in minutes for each subtask
3. Set appropriate priority levels (Low, Medium, High, Urgent)
4. Mark dependencies between subtasks where appropriate
5. Keep the total number of subtasks between 2-8
6. Subtasks should cover the full scope of the parent task
7. Respond in the same language as the task title/description

Respond in JSON format:
{
  "subtasks": [
    {
      "title": "string",
      "description": "string",
      "estimatedMinutes": number,
      "priority": "Low" | "Medium" | "High" | "Urgent",
      "order": number,
      "dependsOnPrevious": boolean
    }
  ],
  "totalEstimatedMinutes": number,
  "feasibilityScore": number (0-100),
  "warnings": ["string"]
}`;
}

/**
 * System prompt for automation suggestions.
 */
export function automationSuggestionSystemPrompt(): string {
  return `You are an intelligent scheduling assistant that analyzes tasks and suggests the best automation strategy.
Given a task with its properties (title, description, priority, schedule, runnability), suggest how it should be executed.

Consider:
1. Whether the task should be executed immediately, scheduled, or run manually
2. What reminder strategy is appropriate (advance time, frequency, channels)
3. What preparation steps are needed before execution
4. What context sources would help execution
5. Respond in the same language as the task title/description

Respond in JSON format:
{
  "executionMode": "immediate" | "scheduled" | "recurring" | "manual",
  "reminderStrategy": {
    "advanceMinutes": number,
    "frequency": "once" | "recurring" | "escalating",
    "channels": ["push" | "email" | "calendar"]
  },
  "preparationSteps": ["string"],
  "contextSources": [
    { "type": "string", "description": "string" }
  ],
  "confidence": "low" | "medium" | "high",
  "reasoning": "string"
}`;
}

/**
 * System prompt for conflict resolution suggestions.
 */
export function conflictResolutionSystemPrompt(): string {
  return `You are an intelligent scheduling conflict resolver. Given a set of schedule conflicts and the associated tasks,
suggest the best resolution strategies.

Consider:
1. Task priorities — higher priority tasks should keep their slots
2. Task dependencies — dependent tasks must follow their prerequisites
3. Due dates — tasks closer to their deadline should be prioritized
4. Working hours — suggest rescheduling within reasonable hours (9:00-18:00)
5. Buffer time — leave some buffer between back-to-back tasks
6. Respond in the same language as the conflict descriptions

Respond in JSON format:
{
  "suggestions": [
    {
      "conflictId": "string",
      "type": "reschedule" | "split" | "defer" | "reorder",
      "description": "string",
      "reason": "string",
      "changes": [
        {
          "taskId": "string",
          "scheduledStartAt": "ISO-8601",
          "scheduledEndAt": "ISO-8601"
        }
      ],
      "estimatedImpact": {
        "resolvedConflicts": number,
        "movedTasks": number,
        "timeShiftMinutes": number
      }
    }
  ]
}`;
}

/**
 * System prompt for timeslot suggestion.
 */
export function timeslotSuggestionSystemPrompt(): string {
  return `You are an intelligent schedule optimizer. Given a task and the current schedule,
suggest the best available timeslots for the task.

Consider:
1. Task priority and estimated duration
2. Existing scheduled blocks (avoid conflicts)
3. Working hours (typically 9:00-18:00)
4. Task dependencies if any
5. Optimal productivity times (morning for complex tasks, afternoon for routine)
6. Buffer time between tasks

Respond in JSON format:
{
  "suggestions": [
    {
      "startAt": "ISO-8601",
      "endAt": "ISO-8601",
      "score": number (0-100),
      "reasons": ["string"],
      "conflicts": []
    }
  ]
}`;
}

/**
 * System prompt for intelligent task creation auto-complete.
 */
export function taskAutoCompleteSystemPrompt(): string {
  return `You are an intelligent task creation assistant. Given a partial task title (which might be in any language),
suggest completions and auto-fill task properties.

Consider:
1. Infer task type from the title (coding, meeting, review, research, etc.)
2. Suggest appropriate priority based on urgency keywords
3. Estimate duration based on task type
4. Suggest description if the title implies a specific scope
5. Respond in the same language as the input title

Respond in JSON format:
{
  "suggestions": [
    {
      "title": "string (completed title)",
      "description": "string",
      "priority": "Low" | "Medium" | "High" | "Urgent",
      "estimatedMinutes": number,
      "tags": ["string"],
      "reasoning": "string"
    }
  ]
}`;
}

/**
 * System prompt for task plan generation.
 */
export function taskPlanSystemPrompt(): string {
  return `You are a task execution planner for an AI agent system. Given a task with its title, description, prompt, and current status,
generate an execution plan with clear steps.

Rules:
1. Break the work into 3-6 phased steps
2. Each step should have a clear objective
3. Include phases like: 理解/Understanding, 准备/Preparation, 执行/Execution, 验证/Verification, 确认/Confirmation
4. Be specific about what should be done in each step
5. Respond in the same language as the task

Respond in JSON format:
{
  "summary": "string",
  "change_summary": "string",
  "notes": ["string"],
  "steps": [
    {
      "id": "string",
      "title": "string",
      "objective": "string",
      "phase": "string"
    }
  ]
}`;
}

import type {
  TaskAutomationInput,
  ExecutionMode,
  ReminderStrategy,
  AutomationSuggestion,
} from "@chrona/contracts/ai";
import { aiChat } from "./ai-service";

function isAutomationSuggestion(
  value: unknown,
): value is AutomationSuggestion {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<AutomationSuggestion>;
  return (
    typeof candidate.executionMode === "string" &&
    !!candidate.reminderStrategy &&
    typeof candidate.confidence === "string" &&
    Array.isArray(candidate.preparationSteps)
  );
}

/**
 * タスクが定期的なものかどうかをタイトルと説明から判定する
 */
function isRecurringTask(task: TaskAutomationInput): boolean {
  const text = `${task.title} ${task.description ?? ""}`.toLowerCase();
  const recurringKeywords = [
    "weekly",
    "daily",
    "monthly",
    "every week",
    "every day",
    "every month",
    "recurring",
    "repeat",
    "routine",
    "standup",
    "stand-up",
    "retrospective",
    "retro",
    "sync",
    "check-in",
  ];
  return recurringKeywords.some((keyword) => text.includes(keyword));
}

/**
 * 実行モードを決定する
 */
function determineExecutionMode(task: TaskAutomationInput): ExecutionMode {
  // Check for recurring patterns first (takes priority)
  if (isRecurringTask(task)) {
    return "recurring";
  }

  if (
    task.isRunnable &&
    (task.priority === "High" || task.priority === "Urgent")
  ) {
    return "immediate";
  }

  if (task.scheduledStartAt) {
    return "scheduled";
  }

  return "manual";
}

/**
 * リマインダー戦略を決定する
 */
function determineReminderStrategy(
  task: TaskAutomationInput,
): ReminderStrategy {
  const isHighPriority = task.priority === "High" || task.priority === "Urgent";
  const isMediumPriority = task.priority === "Medium";

  // Recurring tasks get recurring frequency with calendar integration
  if (isRecurringTask(task)) {
    return {
      advanceMinutes: 30,
      frequency: "recurring",
      channels: ["push", "calendar"],
    };
  }

  if (isHighPriority) {
    return {
      advanceMinutes: 15,
      frequency: "once",
      channels: ["push", "email"],
    };
  }

  if (isMediumPriority) {
    return {
      advanceMinutes: 30,
      frequency: "once",
      channels: ["push"],
    };
  }

  // Low priority or unspecified
  return {
    advanceMinutes: 60,
    frequency: "once",
    channels: ["push"],
  };
}

/**
 * タスクのプロパティに基づいて準備ステップを生成する
 */
function generatePreparationSteps(task: TaskAutomationInput): string[] {
  const steps: string[] = [];

  // Always suggest reviewing the task description
  if (task.description) {
    steps.push("Review task description");
  }

  // If the task is runnable, suggest checking runtime configuration
  if (task.isRunnable) {
    steps.push("Check runtime configuration");
    steps.push("Ensure dependencies are met");

    if (task.runnabilityState) {
      steps.push(`Verify runnability state: ${task.runnabilityState}`);
    }
  }

  // If there's a scheduled time window, suggest verifying availability
  if (task.scheduledStartAt && task.scheduledEndAt) {
    steps.push("Verify availability for the scheduled time window");
  }

  // If there's a due date, suggest checking deadline
  if (task.dueAt) {
    steps.push("Review deadline and plan accordingly");
  }

  // High/Urgent priority tasks get extra preparation
  if (task.priority === "High" || task.priority === "Urgent") {
    steps.push("Prioritize and clear blockers before execution");
  }

  // If tags exist, suggest reviewing related context
  if (task.tags && task.tags.length > 0) {
    steps.push(`Review related context for tags: ${task.tags.join(", ")}`);
  }

  // If owner type is specified, suggest coordination
  if (task.ownerType === "team") {
    steps.push("Coordinate with team members before starting");
  }

  // Fallback: always have at least one step
  if (steps.length === 0) {
    steps.push("Review task details before starting");
  }

  return steps;
}

/**
 * タスクのメタデータに基づいてコンテキストソースを提案する
 */
function generateContextSources(
  task: TaskAutomationInput,
): Array<{ type: string; description: string }> {
  const sources: Array<{ type: string; description: string }> = [];

  // Task description is always a source
  if (task.description) {
    sources.push({
      type: "task_description",
      description: "Primary task description and requirements",
    });
  }

  // If runnable, suggest runtime config as a source
  if (task.isRunnable) {
    sources.push({
      type: "runtime_config",
      description: "Runtime configuration and execution parameters",
    });
  }

  // If tags exist, suggest tag-based sources
  if (task.tags && task.tags.length > 0) {
    sources.push({
      type: "tag_context",
      description: `Related tasks and resources for tags: ${task.tags.join(", ")}`,
    });
  }

  // Schedule-based sources
  if (task.scheduledStartAt) {
    sources.push({
      type: "schedule",
      description: "Calendar and scheduling context for the time window",
    });
  }

  // Due date context
  if (task.dueAt) {
    sources.push({
      type: "deadline",
      description: "Deadline tracking and milestone information",
    });
  }

  // Owner context
  if (task.ownerType) {
    sources.push({
      type: "ownership",
      description: `Task ownership context (${task.ownerType})`,
    });
  }

  return sources;
}

/**
 * 利用可能な情報量に基づいて信頼度を決定する
 */
function determineConfidence(
  task: TaskAutomationInput,
): "low" | "medium" | "high" {
  let infoScore = 0;

  if (task.isRunnable) infoScore++;
  if (task.scheduledStartAt) infoScore++;
  if (task.description) infoScore++;
  if (task.dueAt) infoScore++;
  if (task.scheduledEndAt) infoScore++;
  if (task.tags && task.tags.length > 0) infoScore++;

  if (infoScore >= 4) {
    return "high";
  }

  if (infoScore >= 2) {
    return "medium";
  }

  return "low";
}

/**
 * タスクに対する自動化設定を提案する
 */
export function suggestAutomation(
  task: TaskAutomationInput,
): AutomationSuggestion {
  const executionMode = determineExecutionMode(task);
  const reminderStrategy = determineReminderStrategy(task);
  const preparationSteps = generatePreparationSteps(task);
  const contextSources = generateContextSources(task);
  const confidence = determineConfidence(task);

  return {
    executionMode,
    reminderStrategy,
    preparationSteps,
    contextSources,
    confidence,
  };
}

// ─── LLM-powered suggestion ────────────────────────────

/**
 * Suggest automation using AI intelligence. Falls back to rule-based if AI unavailable.
 */
export async function suggestAutomationSmart(
  task: TaskAutomationInput,
): Promise<AutomationSuggestion> {
  try {
    const result = await suggestAutomationWithAI(task);
    if (result) return result;
  } catch (err) {
    console.warn(
      "[automation-suggester] AI suggestion failed, falling back to rules:",
      err,
    );
  }
  return suggestAutomation(task);
}

async function suggestAutomationWithAI(
  task: TaskAutomationInput,
): Promise<AutomationSuggestion | null> {
  const userPrompt = [
    `Task Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : null,
    `Priority: ${task.priority}`,
    task.dueAt
      ? `Due: ${task.dueAt instanceof Date ? task.dueAt.toISOString() : task.dueAt}`
      : null,
    task.scheduledStartAt
      ? `Scheduled Start: ${task.scheduledStartAt instanceof Date ? task.scheduledStartAt.toISOString() : task.scheduledStartAt}`
      : null,
    `Runnable: ${task.isRunnable}`,
    `Owner Type: ${task.ownerType}`,
    task.tags?.length ? `Tags: ${task.tags.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `You are a task automation assistant. Analyze a task and suggest how to automate it.
Return valid JSON only:
{"executionMode":"immediate|scheduled|recurring|manual","reminderStrategy":{"advanceMinutes":N,"frequency":"once|recurring","channels":["push"]},"preparationSteps":["step1"],"automationNotes":"...","confidence":0.0-1.0}
Respond in the same language as the input.`;

  const chatResult = await aiChat({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    jsonMode: true,
    temperature: 0.3,
    maxTokens: 1000,
  });

  return isAutomationSuggestion(chatResult?.parsed) ? chatResult.parsed : null;
}

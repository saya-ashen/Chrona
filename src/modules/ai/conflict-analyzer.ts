import type {
  ConflictAnalysisResult,
  ScheduledTaskInfo,
  Suggestion,
  Conflict,
} from "./types";
import { detectAllConflicts } from "./conflict-detector";
import { generateSuggestions } from "./suggestion-generator";
import { aiChat } from "./ai-service";

/**
 * 分析日程冲突并生成建议
 */
export function analyzeConflicts(
  tasks: ScheduledTaskInfo[],
): ConflictAnalysisResult {
  // 1. 检测所有冲突
  const conflicts = detectAllConflicts(tasks);

  // 2. 生成建议
  const suggestions = generateSuggestions(conflicts, tasks);

  // 3. 统计摘要
  const highSeverityCount = conflicts.filter((c) => c.severity === "high").length;
  const mediumSeverityCount = conflicts.filter(
    (c) => c.severity === "medium",
  ).length;
  const lowSeverityCount = conflicts.filter((c) => c.severity === "low").length;

  const affectedTaskIds = new Set<string>();
  for (const conflict of conflicts) {
    for (const taskId of conflict.taskIds) {
      affectedTaskIds.add(taskId);
    }
  }

  return {
    conflicts,
    suggestions,
    summary: {
      totalConflicts: conflicts.length,
      highSeverityCount,
      mediumSeverityCount,
      lowSeverityCount,
      affectedTaskCount: affectedTaskIds.size,
    },
  };
}

// ---------- LLM Response Types ----------

interface LLMSuggestionChange {
  taskId: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
}

interface LLMSuggestion {
  conflictId: string;
  type: "reschedule" | "split" | "defer" | "reorder";
  description: string;
  reason: string;
  changes: LLMSuggestionChange[];
  estimatedImpact: {
    resolvedConflicts: number;
    movedTasks: number;
    timeShiftMinutes: number;
  };
}

interface LLMConflictResolutionResponse {
  suggestions: LLMSuggestion[];
}

// ---------- Helper ----------

/**
 * Build a summary of the current schedule state for the LLM prompt.
 */
function buildScheduleContext(
  tasks: ScheduledTaskInfo[],
  conflicts: Conflict[],
): string {
  const taskLines = tasks.map(
    (t) =>
      `- [${t.taskId}] "${t.title}" | priority=${t.priority} ` +
      `| ${t.scheduledStartAt.toISOString()} → ${t.scheduledEndAt.toISOString()} ` +
      `| est=${t.estimatedMinutes}min` +
      (t.dueAt ? ` | due=${t.dueAt.toISOString()}` : "") +
      (t.dependencies.length > 0 ? ` | depends=[${t.dependencies.join(", ")}]` : ""),
  );

  const conflictLines = conflicts.map(
    (c) =>
      `- [${c.id}] type=${c.type} severity=${c.severity} tasks=[${c.taskIds.join(", ")}] — ${c.description}`,
  );

  return [
    "=== TASKS ===",
    ...taskLines,
    "",
    "=== DETECTED CONFLICTS ===",
    ...conflictLines,
  ].join("\n");
}

/**
 * Convert LLM suggestion response into typed Suggestion objects.
 */
function convertLLMSuggestions(
  llmSuggestions: LLMSuggestion[],
  conflicts: Conflict[],
): Suggestion[] {
  const conflictIds = new Set(conflicts.map((c) => c.id));

  return llmSuggestions
    .filter((s) => conflictIds.has(s.conflictId))
    .map((s, idx) => {
      const changes = (s.changes ?? []).map((ch) => ({
        taskId: ch.taskId,
        scheduledStartAt: new Date(ch.scheduledStartAt),
        scheduledEndAt: new Date(ch.scheduledEndAt),
      }));

      const affectedTaskIds = changes.map((ch) => ch.taskId);

      return {
        id: `sugg_llm_${idx}_${s.conflictId}`,
        conflictId: s.conflictId,
        type: s.type as Suggestion["type"],
        description: s.description ?? "",
        reason: s.reason ?? "",
        affectedTaskIds,
        changes,
        estimatedImpact: {
          resolvedConflicts: s.estimatedImpact?.resolvedConflicts ?? 1,
          movedTasks: s.estimatedImpact?.movedTasks ?? changes.length,
          timeShiftMinutes: s.estimatedImpact?.timeShiftMinutes ?? 0,
        },
      } satisfies Suggestion;
    });
}

// ---------- Build summary helper ----------

function buildSummary(conflicts: Conflict[]) {
  const highSeverityCount = conflicts.filter((c) => c.severity === "high").length;
  const mediumSeverityCount = conflicts.filter(
    (c) => c.severity === "medium",
  ).length;
  const lowSeverityCount = conflicts.filter((c) => c.severity === "low").length;

  const affectedTaskIds = new Set<string>();
  for (const conflict of conflicts) {
    for (const taskId of conflict.taskIds) {
      affectedTaskIds.add(taskId);
    }
  }

  return {
    totalConflicts: conflicts.length,
    highSeverityCount,
    mediumSeverityCount,
    lowSeverityCount,
    affectedTaskCount: affectedTaskIds.size,
  };
}

// ---------- Smart Analyzer ----------

/**
 * LLM-enhanced conflict analyzer.
 *
 * 1. Uses the reliable rule-based conflict detector to find conflicts.
 * 2. If the LLM is available AND conflicts exist, asks the LLM for
 *    improved resolution suggestions.
 * 3. Falls back to rule-based suggestions if the LLM call fails or
 *    is unavailable.
 */
export async function analyzeConflictsSmart(
  tasks: ScheduledTaskInfo[],
): Promise<ConflictAnalysisResult> {
  // Step 1: Always use rule-based conflict detection (reliable)
  const conflicts = detectAllConflicts(tasks);

  // Short-circuit: no conflicts → nothing to suggest
  if (conflicts.length === 0) {
    return {
      conflicts,
      suggestions: [],
      summary: buildSummary(conflicts),
    };
  }

  // Step 2: Try AI-enhanced suggestions
  try {
    const context = buildScheduleContext(tasks, conflicts);

    const systemPrompt = `You are a schedule conflict analyzer. Given conflicts and schedule data, suggest concrete resolutions.
Return valid JSON only:
{"suggestions":[{"conflictId":"...","type":"reschedule|split|defer|reorder","description":"...","reason":"...","changes":[{"taskId":"...","scheduledStartAt":"ISO","scheduledEndAt":"ISO"}],"estimatedImpact":{"resolvedConflicts":N,"movedTasks":N,"timeShiftMinutes":N}}]}
Respond in the same language as the input.`;

    const chatResult = await aiChat({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            `Analyze the following schedule conflicts and suggest resolutions:\n\n${context}`,
        },
      ],
      jsonMode: true,
      temperature: 0.4,
      maxTokens: 2048,
    });

    if (chatResult?.parsed) {
      const llmResult = chatResult.parsed as LLMConflictResolutionResponse;
      if (llmResult?.suggestions && Array.isArray(llmResult.suggestions)) {
        const suggestions = convertLLMSuggestions(llmResult.suggestions, conflicts);

        if (suggestions.length > 0) {
          return {
            conflicts,
            suggestions,
            summary: buildSummary(conflicts),
          };
        }
      }
    }
  } catch {
    // AI call failed — fall back to rule-based suggestions
  }

  // Step 3: Fallback to rule-based suggestions
  const suggestions = generateSuggestions(conflicts, tasks);

  return {
    conflicts,
    suggestions,
    summary: buildSummary(conflicts),
  };
}

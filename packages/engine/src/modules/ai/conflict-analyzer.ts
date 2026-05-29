import type { Conflict, ConflictAnalysisResult, ScheduledTaskInfo, Suggestion } from "@chrona/contracts/ai";
import { aiChat } from "./runtime/ai-service";
import {
  detectDependencyConflicts,
  detectFragmentation,
  detectOverload,
  detectTimeOverlaps,
} from "./conflict-detector";

function summarize(conflicts: Conflict[]): ConflictAnalysisResult["summary"] {
  const affectedTaskIds = new Set(conflicts.flatMap((conflict) => conflict.taskIds));

  return {
    totalConflicts: conflicts.length,
    highSeverityCount: conflicts.filter((conflict) => conflict.severity === "high").length,
    mediumSeverityCount: conflicts.filter((conflict) => conflict.severity === "medium").length,
    lowSeverityCount: conflicts.filter((conflict) => conflict.severity === "low").length,
    affectedTaskCount: affectedTaskIds.size,
  };
}

function buildRuleSuggestion(conflict: Conflict, index: number): Suggestion {
  const movedTaskId = conflict.taskIds.at(-1) ?? conflict.taskIds[0] ?? "";

  return {
    id: `sugg_${index}_${conflict.id}`,
    conflictId: conflict.id,
    type: conflict.type === "fragmentation" ? "merge" : "reschedule",
    description: `Resolve ${conflict.type.replace("_", " ")}`,
    reason: conflict.description,
    affectedTaskIds: conflict.taskIds,
    changes: movedTaskId ? [{ taskId: movedTaskId }] : [],
    estimatedImpact: {
      resolvedConflicts: 1,
      movedTasks: movedTaskId ? 1 : 0,
      timeShiftMinutes: 30,
    },
  };
}

function normalizeLlmSuggestions(value: unknown, conflicts: Conflict[]): Suggestion[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  const validConflictIds = new Set(conflicts.map((conflict) => conflict.id));
  const raw = (value as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item, index): Suggestion[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const suggestion = item as Record<string, unknown>;
    const conflictId = typeof suggestion.conflictId === "string" ? suggestion.conflictId : "";
    const type = typeof suggestion.type === "string" ? suggestion.type : "reschedule";
    if (!validConflictIds.has(conflictId)) return [];

    return [{
      id: `sugg_llm_${index}_${conflictId}`,
      conflictId,
      type: type as Suggestion["type"],
      description: typeof suggestion.description === "string" ? suggestion.description : "Resolve conflict",
      reason: typeof suggestion.reason === "string" ? suggestion.reason : "AI generated suggestion",
      affectedTaskIds: Array.isArray(suggestion.affectedTaskIds)
        ? suggestion.affectedTaskIds.filter((id): id is string => typeof id === "string")
        : conflicts.find((conflict) => conflict.id === conflictId)?.taskIds ?? [],
      changes: Array.isArray(suggestion.changes) ? suggestion.changes as Suggestion["changes"] : [],
      estimatedImpact: suggestion.estimatedImpact as Suggestion["estimatedImpact"] ?? {
        resolvedConflicts: 1,
        movedTasks: 0,
        timeShiftMinutes: 0,
      },
    }];
  });
}

function buildLlmPrompt(tasks: ScheduledTaskInfo[], conflicts: Conflict[]) {
  return `Tasks:\n${tasks.map((task) => `${task.taskId}: ${task.title} ${task.priority}`).join("\n")}\n\nConflicts:\n${conflicts.map((conflict) => `${conflict.id}: ${conflict.type} ${conflict.taskIds.join(",")}`).join("\n")}`;
}

export function analyzeConflicts(tasks: ScheduledTaskInfo[]): ConflictAnalysisResult {
  const conflicts = [
    ...detectTimeOverlaps(tasks),
    ...detectOverload(tasks),
    ...detectFragmentation(tasks),
    ...detectDependencyConflicts(tasks),
  ];

  return {
    conflicts,
    suggestions: conflicts.map((conflict, index) => buildRuleSuggestion(conflict, index)),
    summary: summarize(conflicts),
  };
}

export async function analyzeConflictsSmart(tasks: ScheduledTaskInfo[]): Promise<ConflictAnalysisResult> {
  const ruleResult = analyzeConflicts(tasks);
  if (ruleResult.conflicts.length === 0) return ruleResult;

  try {
    const response = await aiChat({
      messages: [
        { role: "system", content: "Suggest schedule conflict resolutions as structured JSON." },
        { role: "user", content: buildLlmPrompt(tasks, ruleResult.conflicts) },
      ],
    });
    const suggestions = normalizeLlmSuggestions(response?.parsed, ruleResult.conflicts);
    if (suggestions.length > 0) {
      return { ...ruleResult, suggestions };
    }
  } catch {
    return ruleResult;
  }

  return ruleResult;
}

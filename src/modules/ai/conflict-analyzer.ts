import type { ConflictAnalysisResult, ScheduledTaskInfo } from "./types";
import { detectAllConflicts } from "./conflict-detector";
import { generateSuggestions } from "./suggestion-generator";

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

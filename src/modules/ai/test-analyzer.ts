/**
 * 测试冲突分析功能的脚本
 */
import { analyzeConflicts } from "./conflict-analyzer";
import type { ScheduledTaskInfo } from "./types";

// 创建测试数据
const testTasks: ScheduledTaskInfo[] = [
  {
    taskId: "task1",
    title: "Morning Meeting",
    priority: "High",
    scheduledStartAt: new Date("2026-04-15T09:00:00Z"),
    scheduledEndAt: new Date("2026-04-15T10:00:00Z"),
    dueAt: null,
    estimatedMinutes: 60,
    dependencies: [],
  },
  {
    taskId: "task2",
    title: "Code Review",
    priority: "Medium",
    scheduledStartAt: new Date("2026-04-15T09:30:00Z"),
    scheduledEndAt: new Date("2026-04-15T10:30:00Z"),
    dueAt: null,
    estimatedMinutes: 60,
    dependencies: [],
  },
  {
    taskId: "task3",
    title: "Quick Email",
    priority: "Low",
    scheduledStartAt: new Date("2026-04-15T11:00:00Z"),
    scheduledEndAt: new Date("2026-04-15T11:15:00Z"),
    dueAt: null,
    estimatedMinutes: 15,
    dependencies: [],
  },
  {
    taskId: "task4",
    title: "Another Quick Task",
    priority: "Low",
    scheduledStartAt: new Date("2026-04-15T11:30:00Z"),
    scheduledEndAt: new Date("2026-04-15T11:45:00Z"),
    dueAt: null,
    estimatedMinutes: 15,
    dependencies: [],
  },
  {
    taskId: "task5",
    title: "Long Project Work",
    priority: "High",
    scheduledStartAt: new Date("2026-04-15T13:00:00Z"),
    scheduledEndAt: new Date("2026-04-15T18:00:00Z"),
    dueAt: null,
    estimatedMinutes: 300,
    dependencies: [],
  },
];

// 运行分析
console.log("🔍 Analyzing conflicts...\n");
const result = analyzeConflicts(testTasks);

console.log("📊 Summary:");
console.log(`  Total conflicts: ${result.summary.totalConflicts}`);
console.log(`  High severity: ${result.summary.highSeverityCount}`);
console.log(`  Medium severity: ${result.summary.mediumSeverityCount}`);
console.log(`  Low severity: ${result.summary.lowSeverityCount}`);
console.log(`  Affected tasks: ${result.summary.affectedTaskCount}`);
console.log();

console.log("⚠️  Conflicts:");
for (const conflict of result.conflicts) {
  console.log(`  [${conflict.severity.toUpperCase()}] ${conflict.type}`);
  console.log(`    ${conflict.description}`);
  console.log(`    Tasks: ${conflict.taskIds.join(", ")}`);
  console.log();
}

console.log("💡 Suggestions:");
for (const suggestion of result.suggestions) {
  console.log(`  ${suggestion.type}: ${suggestion.description}`);
  console.log(`    Reason: ${suggestion.reason}`);
  console.log(`    Impact: ${suggestion.estimatedImpact.resolvedConflicts} conflicts resolved, ${suggestion.estimatedImpact.movedTasks} tasks moved`);
  console.log();
}

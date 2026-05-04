import { createTable, formatKeyValue, getArray, getObject, type TableCell } from "./index.js";

export function formatWorkspace(value: unknown): string {
  const data = getObject(value);
  const summary = getObject(data.summary);
  const scheduled = getArray(data.scheduled);
  const risks = getArray(data.risks);

  const blocks = [
    formatKeyValue("Workspace schedule", [
      ["Scheduled", summary.scheduledCount],
      ["Unscheduled", summary.unscheduledCount],
      ["Proposals", summary.proposalCount],
      ["Risks", summary.riskCount],
    ]),
  ];

  if (scheduled.length > 0) {
    blocks.push(
      createTable(
        ["ID", "Title", "Priority", "Start", "End", "Status"],
        scheduled.map((task) => [
          String(task.taskId ?? "").slice(0, 8),
          String(task.title ?? "").slice(0, 32),
          String(task.priority ?? ""),
          String(task.scheduledStartAt ?? ""),
          String(task.scheduledEndAt ?? ""),
          String(task.scheduleStatus ?? ""),
        ] satisfies TableCell[]),
      ),
    );
  }

  if (risks.length > 0) {
    blocks.push(
      createTable(
        ["Risk task", "Title", "Status"],
        risks.map((task) => [
          String(task.taskId ?? "").slice(0, 8),
          String(task.title ?? ""),
          String(task.scheduleStatus ?? ""),
        ] satisfies TableCell[]),
      ),
    );
  }

  return blocks.join("\n\n");
}

function formatConflicts(value: unknown): string {
  const data = getObject(value);
  const summary = getObject(data.summary);
  const conflicts = getArray(data.conflicts);
  const suggestions = getArray(data.suggestions);

  const blocks = [
    formatKeyValue("Conflict analysis", [
      ["Total conflicts", summary.totalConflicts],
      ["High severity", summary.highSeverityCount],
      ["Medium severity", summary.mediumSeverityCount],
      ["Low severity", summary.lowSeverityCount],
      ["Affected tasks", summary.affectedTaskCount],
    ]),
  ];

  if (conflicts.length > 0) {
    blocks.push(
      createTable(
        ["ID", "Type", "Severity", "Tasks", "Description"],
        conflicts.map((conflict) => [
          String(conflict.id ?? "").slice(0, 8),
          String(conflict.type ?? ""),
          String(conflict.severity ?? ""),
          Array.isArray(conflict.taskIds) ? conflict.taskIds.join(", ") : "",
          String(conflict.description ?? ""),
        ] satisfies TableCell[]),
      ),
    );
  }

  if (suggestions.length > 0) {
    blocks.push(
      createTable(
        ["ID", "Type", "Description", "Reason"],
        suggestions.map((suggestion) => [
          String(suggestion.id ?? "").slice(0, 8),
          String(suggestion.type ?? ""),
          String(suggestion.description ?? ""),
          String(suggestion.reason ?? ""),
        ] satisfies TableCell[]),
      ),
    );
  }

  return blocks.join("\n\n");
}

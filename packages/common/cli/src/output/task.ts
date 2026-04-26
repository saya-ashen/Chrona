import { createTable, formatKeyValue, getArray, getObject, type TableCell } from "./index.js";

export function formatTaskList(value: unknown): string {
  const tasks = getArray(value, ["tasks", "subtasks", "childTasks"]);
  if (tasks.length === 0) {
    return "No tasks found.";
  }

  return createTable(
    ["ID", "Title", "Status", "Priority", "Due", "Scheduled"],
    tasks.map((task) => [
      String(task.id ?? task.taskId ?? "").slice(0, 12),
      String(task.title ?? "").slice(0, 40),
      String(task.status ?? task.persistedStatus ?? ""),
      String(task.priority ?? ""),
      typeof task.dueAt === "string" ? task.dueAt.slice(0, 10) : String(task.dueAt ?? ""),
      typeof task.scheduledStartAt === "string"
        ? task.scheduledStartAt.slice(0, 16)
        : String(task.scheduledStartAt ?? ""),
    ] satisfies TableCell[]),
  );
}

export function formatTaskDetail(value: unknown): string {
  const outer = getObject(value);
  const task = getObject(outer.task ?? outer.subtask ?? value);

  return formatKeyValue("Task", [
    ["ID", task.id ?? task.taskId],
    ["Title", task.title],
    ["Status", task.status ?? task.persistedStatus],
    ["Priority", task.priority],
    ["Description", task.description],
    ["Due", task.dueAt],
    ["Scheduled start", task.scheduledStartAt],
    ["Scheduled end", task.scheduledEndAt],
    ["Runtime adapter", task.runtimeAdapterKey],
    ["Runtime model", task.runtimeModel],
    ["Prompt", task.prompt],
    ["Created", task.createdAt],
    ["Updated", task.updatedAt],
  ]);
}

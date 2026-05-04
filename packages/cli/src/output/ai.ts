import { createTable, formatKeyValue, getArray, getObject, type TableCell } from "./index.js";

export function formatAutoComplete(value: unknown): string {
  const data = getObject(value);
  const suggestions = getArray(data.suggestions);

  if (suggestions.length === 0) {
    return formatKeyValue("Auto-complete", [
      ["Source", data.source],
      ["Request ID", data.requestId],
    ]);
  }

  return createTable(
    ["ID", "Summary", "Action", "Title", "Priority"],
    suggestions.map((suggestion) => {
      const action = getObject(suggestion.action);
      return [
        String(suggestion.id ?? "").slice(0, 8),
        String(suggestion.summary ?? ""),
        String(action.type ?? ""),
        String(action.title ?? ""),
        String(action.priority ?? ""),
      ] satisfies TableCell[];
    }),
  );
}

export function formatPlanResult(value: unknown): string {
  const data = getObject(value);
  const planGraph = getObject(data.planGraph);
  const nodes = getArray(planGraph.nodes);
  const childTasks = getArray(data.childTasks);

  const blocks = [
    formatKeyValue("Task plan", [
      ["Source", data.source],
      ["Plan ID", planGraph.id],
      ["Task ID", planGraph.taskId ?? data.parentTaskId],
      ["Status", planGraph.status],
      ["Revision", planGraph.revision],
      ["Summary", planGraph.summary],
      ["Nodes", nodes.length],
      ["Child tasks", childTasks.length],
    ]),
  ];

  if (nodes.length > 0) {
    blocks.push(
      createTable(
        ["Node", "Title", "Kind", "Status"],
        nodes.map((node) => [
          String(node.id ?? ""),
          String(node.title ?? ""),
          String(node.kind ?? ""),
          String(node.status ?? ""),
        ] satisfies TableCell[]),
      ),
    );
  }

  return blocks.join("\n\n");
}

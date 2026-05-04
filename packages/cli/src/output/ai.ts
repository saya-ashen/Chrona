import { createTable, formatKeyValue, getArray, getObject, type TableCell } from "./index.js";

export function formatAutomation(value: unknown): string {
  const data = getObject(value);
  const reminder = getObject(data.reminderStrategy);
  const steps = Array.isArray(data.preparationSteps) ? data.preparationSteps : [];
  const contextSources = getArray(data.contextSources);

  const blocks = [
    formatKeyValue("Automation suggestion", [
      ["Execution mode", data.executionMode],
      ["Confidence", data.confidence],
      ["Reminder advance minutes", reminder.advanceMinutes],
      ["Reminder frequency", reminder.frequency],
      ["Reminder channels", Array.isArray(reminder.channels) ? reminder.channels.join(", ") : reminder.channels],
    ]),
  ];

  if (steps.length > 0) {
    blocks.push(steps.map((step, index) => `${index + 1}. ${String(step)}`).join("\n"));
  }

  if (contextSources.length > 0) {
    blocks.push(
      createTable(
        ["Type", "Description"],
        contextSources.map((source) => [String(source.type ?? ""), String(source.description ?? "")] satisfies TableCell[]),
      ),
    );
  }

  return blocks.join("\n\n");
}

export function formatSuggestionApplyResult(value: unknown): string {
  const data = getObject(value);
  return formatKeyValue("Suggestion apply result", [
    ["Success", data.success],
    ["Applied changes", data.appliedChanges],
    ["Suggestion ID", data.suggestionId],
    ["Task ID", data.taskId],
    ["Action", data.action],
    ["Summary", data.summary],
  ]);
}

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

export function formatAiStatus(value: unknown): string {
  const data = getObject(value);
  const clients = getArray(data.clients);

  const blocks = [
    formatKeyValue("AI status", [["Available", data.available]]),
  ];

  if (clients.length > 0) {
    blocks.push(
      createTable(
        ["Client", "Provider", "Features"],
        clients.map((client) => [
          String(client.id ?? client.clientId ?? ""),
          String(client.provider ?? client.name ?? ""),
          Array.isArray(client.features) ? client.features.join(", ") : String(client.features ?? ""),
        ] satisfies TableCell[]),
      ),
    );
  }

  return blocks.join("\n\n");
}

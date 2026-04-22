// @ts-ignore - resolved by OpenClaw runtime
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const PriorityEnum = ["Low", "Medium", "High", "Urgent"] as const;

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizePriority(value: unknown): (typeof PriorityEnum)[number] {
  return PriorityEnum.includes(value as (typeof PriorityEnum)[number])
    ? (value as (typeof PriorityEnum)[number])
    : "Medium";
}

function normalizeSuggestions(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    )
    .map((item) => ({
      title: typeof item.title === "string" ? item.title : "",
      description: typeof item.description === "string" ? item.description : "",
      priority: normalizePriority(item.priority),
      estimatedMinutes:
        typeof item.estimatedMinutes === "number" &&
        Number.isFinite(item.estimatedMinutes)
          ? Math.max(5, Math.round(item.estimatedMinutes))
          : 30,
      tags: normalizeStringArray(item.tags),
      suggestedSlot:
        item.suggestedSlot && typeof item.suggestedSlot === "object"
          ? {
              startAt:
                typeof (item.suggestedSlot as Record<string, unknown>)
                  .startAt === "string"
                  ? String(
                      (item.suggestedSlot as Record<string, unknown>).startAt,
                    )
                  : "",
              endAt:
                typeof (item.suggestedSlot as Record<string, unknown>).endAt ===
                "string"
                  ? String(
                      (item.suggestedSlot as Record<string, unknown>).endAt,
                    )
                  : "",
            }
          : undefined,
    }))
    .filter((item) => item.title.trim().length > 0);
}

function normalizePlanGraph(input: unknown) {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return {
    summary: typeof value.summary === "string" ? value.summary : "",
    reasoning:
      typeof value.reasoning === "string" ? value.reasoning : undefined,
    nodes: Array.isArray(value.nodes) ? value.nodes : [],
    edges: Array.isArray(value.edges) ? value.edges : [],
  };
}

function hasNonEmptyPlanGraph(graph: ReturnType<typeof normalizePlanGraph>) {
  return graph.summary.trim().length > 0 && graph.nodes.length > 0;
}

const SuggestTaskCompletionsSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "Generate user-visible task suggestions for schedule quick create and smart auto-complete.",
  required: ["input"],
  properties: {
    input: {
      type: "string",
      minLength: 1,
      description:
        "Raw user input. Preserve the full original text; do not truncate or silently rewrite it.",
    },
    workspaceId: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Optional workspace identifier for contextual suggestions.",
    },
    context: {
      anyOf: [{ type: "object" }, { type: "null" }],
      description:
        "Optional contextual information such as existing tasks or schedule state.",
    },
  },
} as const;

const TaskPlanNodeSchema = {
  type: "object",
  additionalProperties: true,
  required: ["id", "title"],
  properties: {
    id: { type: "string", minLength: 1 },
    type: { type: "string" },
    title: { type: "string", minLength: 1 },
    objective: { anyOf: [{ type: "string" }, { type: "null" }] },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    estimatedMinutes: { anyOf: [{ type: "number" }, { type: "null" }] },
    priority: { anyOf: [{ type: "string" }, { type: "null" }] },
    executionMode: { anyOf: [{ type: "string" }, { type: "null" }] },
    requiresHumanInput: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    requiresHumanApproval: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    autoRunnable: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    blockingReason: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

const TaskPlanEdgeSchema = {
  type: "object",
  additionalProperties: true,
  required: ["id", "fromNodeId", "toNodeId", "type"],
  properties: {
    id: { type: "string", minLength: 1 },
    fromNodeId: { type: "string", minLength: 1 },
    toNodeId: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
  },
} as const;

const GenerateTaskPlanGraphSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "LLM must put the generated plan graph directly into this tool input. Chrona treats this tool input as the business source of truth for generate_plan.",
  required: ["title", "summary", "nodes", "edges"],
  properties: {
    taskId: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "Optional persisted task id when decomposing an existing task.",
    },
    title: {
      type: "string",
      minLength: 1,
      description: "Task title being decomposed.",
    },
    description: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Optional task description.",
    },
    estimatedMinutes: {
      anyOf: [{ type: "number", minimum: 1 }, { type: "null" }],
      description: "Optional total estimated minutes for the task.",
    },
    summary: { type: "string", minLength: 1 },
    reasoning: { anyOf: [{ type: "string" }, { type: "null" }] },
    nodes: { type: "array", items: TaskPlanNodeSchema },
    edges: { type: "array", items: TaskPlanEdgeSchema },
  },
} as const;

export default definePluginEntry({
  id: "chrona-structured-result",
  name: "Chrona Structured Result",
  description:
    "Provides readable Chrona business tools for suggestions and task-plan graphs.",
  reload: { restartPrefixes: ["gateway", "plugins"] },
  register(api) {
    api.registerTool(
      {
        name: "suggest_task_completions",
        label: "Suggest Task Completions",
        description:
          "Business tool for schedule quick-create and auto-complete. Use this to generate readable task suggestions from the raw user input.",
        parameters: SuggestTaskCompletionsSchema,
        async execute(_toolCallId, params) {
          const context =
            params.context && typeof params.context === "object"
              ? (params.context as Record<string, unknown>)
              : {};
          const input =
            typeof params.input === "string" ? params.input.trim() : "";
          const baseTitle = input || "New task";
          const suggestions = normalizeSuggestions(
            (context.precomputedSuggestions as unknown[] | undefined) ?? [
              {
                title: baseTitle,
                description:
                  typeof context.description === "string"
                    ? context.description
                    : "",
                priority: context.priority,
                estimatedMinutes: context.estimatedMinutes,
                tags: context.tags,
                suggestedSlot: context.suggestedSlot,
              },
            ],
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { ok: true, suggestionCount: suggestions.length },
                  null,
                  2,
                ),
              },
            ],
            details: {
              suggestions,
              summary: `Generated ${suggestions.length} suggestion(s) for quick create.`,
              inputPreview: input.slice(0, 120),
              workspaceId:
                typeof params.workspaceId === "string"
                  ? params.workspaceId
                  : null,
            },
          };
        },
      },
      { name: "suggest_task_completions" },
    );

    api.registerTool(
      {
        name: "generate_task_plan_graph",
        label: "Generate Task Plan Graph",
        description:
          "Business tool for task decomposition. The model should pass the graph directly in tool input; Chrona parses that input as the source of truth.",
        parameters: GenerateTaskPlanGraphSchema,
        async execute(_toolCallId, params) {
          const graph = normalizePlanGraph(params);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: hasNonEmptyPlanGraph(graph),
                    summary:
                      graph.summary || "generate_task_plan_graph completed",
                    nodeCount: graph.nodes.length,
                    edgeCount: graph.edges.length,
                  },
                  null,
                  2,
                ),
              },
            ],
            details: {
              ...graph,
              taskId: typeof params.taskId === "string" ? params.taskId : null,
              title: typeof params.title === "string" ? params.title : "",
              inputMode: "graph_in_tool_input",
              ok: hasNonEmptyPlanGraph(graph),
            },
          };
        },
      },
      { name: "generate_task_plan_graph" },
    );

    api.logger.info("Chrona structured-result plugin loaded");
  },
});

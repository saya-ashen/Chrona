import type { BridgeEnvironment, BridgeFeature } from "./types";

export const LOG_LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

function normalizeGatewayUrl(url: string): string {
  if (url.startsWith("wss://")) {
    return `https://${url.slice("wss://".length)}`.replace(/\/+$/, "");
  }
  if (url.startsWith("ws://")) {
    return `http://${url.slice("ws://".length)}`.replace(/\/+$/, "");
  }
  return url.replace(/\/+$/, "");
}

export const DEFAULT_BRIDGE_ENVIRONMENT: BridgeEnvironment = {
  defaultPort: Number(process.env.OPENCLAW_BRIDGE_PORT ?? "7677"),
  gatewayUrl: normalizeGatewayUrl(
    process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789",
  ),
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN ?? "",
  agentId: process.env.OPENCLAW_AGENT_ID ?? "main",
};

export { normalizeGatewayUrl };

export const FEATURE_ENDPOINTS: Array<{
  pathname: string;
  feature: BridgeFeature;
  stream: boolean;
}> = [
  { pathname: "/v1/features/suggest", feature: "suggest", stream: false },
  { pathname: "/v1/features/suggest/stream", feature: "suggest", stream: true },
  {
    pathname: "/v1/features/generate-plan",
    feature: "generate_plan",
    stream: false,
  },
  {
    pathname: "/v1/features/generate-plan/stream",
    feature: "generate_plan",
    stream: true,
  },
  {
    pathname: "/v1/features/analyze-conflicts",
    feature: "conflicts",
    stream: false,
  },
  {
    pathname: "/v1/features/suggest-timeslot",
    feature: "timeslots",
    stream: false,
  },
  { pathname: "/v1/features/chat", feature: "chat", stream: false },
  {
    pathname: "/v1/features/dispatch-task",
    feature: "dispatch_task",
    stream: false,
  },
];

export const FUNCTION_TOOL_SCHEMAS: Record<string, Record<string, unknown>> = {
  suggest_task_completions: {
    type: "object",
    additionalProperties: true,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            priority: { type: "string" },
            estimatedMinutes: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["title"],
        },
      },
    },
    required: ["suggestions"],
  },
  generate_task_plan_graph: {
    type: "object",
    additionalProperties: true,
    properties: {
      summary: { type: "string" },
      reasoning: { type: "string" },
      nodes: { type: "array", items: { type: "object" } },
      edges: { type: "array", items: { type: "object" } },
    },
    required: ["summary", "nodes", "edges"],
  },
  dispatch_next_task_action: {
    type: "object",
    additionalProperties: true,
    properties: {
      schemaName: { const: "task_dispatch_decision" },
      schemaVersion: { const: "1.0.0" },
      action: { type: "string" },
      safety: { type: "object" },
      confidence: { type: "number" },
      reason: { type: "string" },
    },
    required: [
      "schemaName",
      "schemaVersion",
      "action",
      "safety",
      "confidence",
      "reason",
    ],
  },
};

export const FEATURE_FUNCTION_TOOL: Partial<Record<BridgeFeature, string>> = {
  suggest: "suggest_task_completions",
  generate_plan: "generate_task_plan_graph",
  dispatch_task: "dispatch_next_task_action",
};

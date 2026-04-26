import type { BridgeFeature } from "../transport/bridge-types";
import type { BridgeEnvironment } from "./types";

function normalizeGatewayHttpUrl(url: string, sourceEnvName: string): string {
  const trimmed = url.trim();

  if (trimmed.startsWith("ws://")) {
    if (sourceEnvName === "OPENCLAW_GATEWAY_URL") {
      return `http://${trimmed.slice("ws://".length)}`.replace(/\/+$/, "");
    }
    throw new Error(
      `${sourceEnvName} must be an http(s) URL for the Gateway OpenResponses compatibility endpoint, not a ws(s) URL`,
    );
  }

  if (trimmed.startsWith("wss://")) {
    if (sourceEnvName === "OPENCLAW_GATEWAY_URL") {
      return `https://${trimmed.slice("wss://".length)}`.replace(/\/+$/, "");
    }
    throw new Error(
      `${sourceEnvName} must be an http(s) URL for the Gateway OpenResponses compatibility endpoint, not a ws(s) URL`,
    );
  }

  return trimmed.replace(/\/+$/, "");
}

const openResponsesUrl = process.env.OPENCLAW_OPENRESPONSES_URL;
const legacyGatewayUrl = process.env.OPENCLAW_GATEWAY_URL;

export const DEFAULT_OPENCLAW_ENVIRONMENT: BridgeEnvironment = {
  defaultPort: Number(process.env.OPENCLAW_BRIDGE_PORT ?? "7677"),
  gatewayHttpUrl: normalizeGatewayHttpUrl(
    openResponsesUrl ?? legacyGatewayUrl ?? "http://127.0.0.1:18789",
    openResponsesUrl
      ? "OPENCLAW_OPENRESPONSES_URL"
      : legacyGatewayUrl
        ? "OPENCLAW_GATEWAY_URL"
        : "default",
  ),
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN ?? "",
  agentId: process.env.OPENCLAW_AGENT_ID ?? "main",
  model: process.env.OPENCLAW_MODEL?.trim() || undefined,
  messageChannel: process.env.OPENCLAW_MESSAGE_CHANNEL?.trim() || undefined,
};

export { normalizeGatewayHttpUrl };

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
      nodes: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            type: {
              type: "string",
              enum: [
                "step",
                "checkpoint",
                "decision",
                "user_input",
                "deliverable",
                "tool_action",
              ],
            },
            title: { type: "string" },
            objective: { type: "string" },
            description: { type: "string" },
            phase: { type: "string" },
            estimatedMinutes: { type: "number" },
            priority: {
              type: "string",
              enum: ["Low", "Medium", "High", "Urgent"],
            },
            executionMode: {
              type: "string",
              enum: ["automatic", "manual", "hybrid"],
            },
            requiresHumanInput: { type: "boolean" },
            requiresHumanApproval: { type: "boolean" },
          },
          required: ["id", "type", "title", "objective"],
        },
      },
      edges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            fromNodeId: { type: "string" },
            toNodeId: { type: "string" },
            type: {
              type: "string",
              enum: ["blocks", "parallel", "informs", "feeds_output"],
            },
          },
          required: ["id", "fromNodeId", "toNodeId", "type"],
        },
      },
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

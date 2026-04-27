import type { BridgeFeature } from "../transport/bridge-types";
import type { BridgeEnvironment } from "./types";

export const DEFAULT_OPENCLAW_ENVIRONMENT: BridgeEnvironment = {
  defaultPort: 7677,
  gatewayHttpUrl: "",
  gatewayToken: "",
  agentId: "main",
  model: undefined,
  messageChannel: undefined,
};

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
            id: { type: "string", description: "Stable local node id such as node-1." },
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
            title: { type: "string", description: "Short node label shown to the user." },
            objective: { type: "string", description: "What this node achieves when completed." },
            description: { type: "string", description: "Optional implementation detail for the node." },
            phase: { type: "string", description: "Optional coarse stage label." },
            estimatedMinutes: { type: "number", description: "Best-effort duration estimate for just this node." },
            priority: {
              type: "string",
              enum: ["Low", "Medium", "High", "Urgent"],
              description: "Relative urgency of this node.",
            },
            executor: {
              type: "string",
              enum: ["human", "automation"],
              description:
                "Who must perform the node. Use 'automation' ONLY when Chrona/runtime could complete it entirely in software without a person acting in the physical world or supplying new information. Use 'human' for approvals, choices, clarifications, payment, pickup, travel, waiting, receiving items, and any in-person/manual action.",
            },
            requiresHumanInput: {
              type: "boolean",
              description:
                "Set true when this node cannot proceed until a person provides missing information, makes a choice, or confirms details.",
            },
            requiresHumanApproval: {
              type: "boolean",
              description:
                "Set true when this node is an approval/review/sign-off gate that must be explicitly approved by a person.",
            },
          },
          required: ["id", "type", "title", "objective", "executor", "requiresHumanInput", "requiresHumanApproval"],
        },
      },
      edges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string", description: "Stable local edge id such as edge-1." },
            fromNodeId: { type: "string", description: "Upstream/source node id." },
            toNodeId: { type: "string", description: "Downstream/target node id." },
            type: {
              type: "string",
              enum: ["sequential", "depends_on", "branches_to", "unblocks", "feeds_output"],
              description:
                "Edge meaning. sequential = ordinary next step; depends_on = target cannot start until source completes; branches_to = source leads to one branch path; unblocks = source removes a blocker from target; feeds_output = target consumes output/artifact from source.",
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

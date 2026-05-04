import type { BridgeEnvironment, BridgeFeature } from "./types";
import {
  AI_CHECKPOINT_TYPES,
  AI_CONDITION_EVALUATORS,
  AI_PLAN_COMPLETION_POLICY_TYPES,
  AI_PLAN_NODE_TYPES,
  AI_TASK_EXECUTORS,
  AI_TASK_MODES,
  AI_WAIT_TIMEOUT_ACTIONS,
} from "@chrona/contracts/ai";

export const LOG_LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

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

export const DEFAULT_BRIDGE_ENVIRONMENT: BridgeEnvironment = {
  defaultPort: Number(process.env.OPENCLAW_BRIDGE_PORT ?? "7677"),
  gatewayHttpUrl: normalizeGatewayHttpUrl(
    openResponsesUrl ?? legacyGatewayUrl ?? "http://127.0.0.1:18789",
    openResponsesUrl ? "OPENCLAW_OPENRESPONSES_URL" : legacyGatewayUrl ? "OPENCLAW_GATEWAY_URL" : "default",
  ),
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN ?? "",
  agentId: process.env.OPENCLAW_AGENT_ID ?? "main",
  model: process.env.OPENCLAW_MODEL?.trim() || undefined,
  messageChannel: process.env.OPENCLAW_MESSAGE_CHANNEL?.trim() || undefined,
};



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
  analyze_schedule_conflicts: {
    type: "object",
    additionalProperties: true,
    properties: {
      conflicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            type: {
              type: "string",
              enum: ["time_overlap", "overload", "fragmentation", "dependency"],
            },
            severity: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            taskIds: { type: "array", items: { type: "string" } },
            description: { type: "string" },
          },
          required: ["id", "type", "severity", "taskIds", "description"],
        },
      },
      resolutions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            conflictId: { type: "string" },
            type: {
              type: "string",
              enum: ["reschedule", "split", "merge", "defer", "reorder"],
            },
            description: { type: "string" },
            reason: { type: "string" },
            changes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  taskId: { type: "string" },
                  scheduledStartAt: { type: "string" },
                  scheduledEndAt: { type: "string" },
                },
                required: ["taskId"],
              },
            },
          },
          required: ["conflictId", "type", "description", "reason", "changes"],
        },
      },
      summary: { type: "string" },
    },
    required: ["conflicts", "resolutions", "summary"],
  },
  generate_task_plan_graph: {
    type: "object",
    additionalProperties: true,
    properties: {
      title: {
        type: "string",
        description: "Brief plan title.",
      },
      goal: {
        type: "string",
        description: "What this plan is meant to achieve.",
      },
      summary: {
        type: "string",
        description: "One concise sentence describing the generated plan.",
      },
      reasoning: {
        type: "string",
        description: "Brief rationale for the decomposition. Do not ask questions here.",
      },
      nodes: {
        type: "array",
        description: "Execution nodes in dependency order. Provide at least one node.",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string", description: "Stable local id, e.g. node-1." },
            type: {
              type: "string",
              enum: [...AI_PLAN_NODE_TYPES],
            },
            title: { type: "string", description: "Short node label shown to the user." },
            description: { type: "string", description: "Optional implementation detail for the node." },
            expectedOutput: {
              type: "string",
              description: "What successful completion of this node should produce.",
            },
            completionCriteria: {
              type: "string",
              description: "How to determine the node is done.",
            },
            estimatedMinutes: { type: "number", description: "Best-effort duration estimate for just this node." },
            priority: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "Relative urgency of this node.",
            },
            executor: {
              type: "string",
              enum: [...AI_TASK_EXECUTORS],
              description:
                "Who must perform the node. Use 'ai' when model-driven software work can complete it, 'system' for deterministic software automation/integrations, and 'user' for approvals, choices, clarifications, payment, pickup, travel, waiting, receiving items, or any in-person/manual action.",
            },
            mode: {
              type: "string",
              enum: [...AI_TASK_MODES],
              description:
                "manual = user performs it, assist = AI helps while user remains active, auto = fully software-executable.",
            },
            checkpointType: {
              type: "string",
              enum: [...AI_CHECKPOINT_TYPES],
              description: "Checkpoint subtype for human confirmation, choice, input, edit, or approval.",
            },
            prompt: {
              type: "string",
              description: "Prompt shown to the user for checkpoint nodes.",
            },
            required: {
              type: "boolean",
              description: "Whether the checkpoint can be skipped.",
            },
            options: {
              type: "array",
              items: { type: "string" },
              description: "Available options for choose-style checkpoints.",
            },
            targetNodeId: {
              type: "string",
              description: "Optional downstream node gated by this checkpoint.",
            },
            condition: {
              type: "string",
              description: "Human-readable branching condition.",
            },
            evaluationBy: {
              type: "string",
              enum: [...AI_CONDITION_EVALUATORS],
              description: "Who evaluates the condition.",
            },
            branches: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  label: { type: "string" },
                  nextNodeId: { type: "string" },
                },
                required: ["label", "nextNodeId"],
              },
              description: "Branches for condition nodes.",
            },
            defaultNextNodeId: {
              type: "string",
              description: "Fallback target when no branch matches.",
            },
            waitFor: {
              type: "string",
              description: "External event or condition to wait for.",
            },
            timeout: {
              type: "object",
              additionalProperties: true,
              properties: {
                minutes: { type: "number" },
                onTimeout: {
                  type: "string",
                  enum: [...AI_WAIT_TIMEOUT_ACTIONS],
                },
              },
              required: ["minutes", "onTimeout"],
            },
          },
          required: ["id", "type", "title"],
        },
      },
      edges: {
        type: "array",
        description: "Directed dependencies between nodes. Use [] only when there is a single independent node.",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            from: { type: "string", description: "Upstream/source node id." },
            to: { type: "string", description: "Downstream/target node id." },
            label: { type: "string", description: "Optional edge label." },
          },
          required: ["from", "to"],
        },
      },
      completionPolicy: {
        type: "object",
        additionalProperties: true,
        properties: {
          type: {
            type: "string",
            enum: [...AI_PLAN_COMPLETION_POLICY_TYPES],
          },
          nodeIds: {
            type: "array",
            items: { type: "string" },
          },
          description: { type: "string" },
        },
        required: ["type"],
      },
    },
    required: ["title", "goal", "nodes", "edges"],
  },
  suggest_task_timeslots: {
    type: "object",
    additionalProperties: true,
    properties: {
      slots: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            startAt: { type: "string" },
            endAt: { type: "string" },
            score: { type: "number" },
            reason: { type: "string" },
          },
          required: ["startAt", "endAt", "score", "reason"],
        },
      },
      reasoning: { type: "string" },
    },
    required: ["slots"],
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
  conflicts: "analyze_schedule_conflicts",
  timeslots: "suggest_task_timeslots",
  dispatch_task: "dispatch_next_task_action",
};

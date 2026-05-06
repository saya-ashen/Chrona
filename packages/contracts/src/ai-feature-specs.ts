import type { GenerateTaskPlanRequest } from "./ai-plan-runtime";
import {
  AI_CHECKPOINT_TYPES,
  AI_CONDITION_EVALUATORS,
  AI_PLAN_NODE_TYPES,
  AI_TASK_EXECUTORS,
  AI_TASK_MODES,
  AI_WAIT_TIMEOUT_ACTIONS,
} from "./ai-plan-blueprint";
import { normalizeGeneratePlanResponse } from "@chrona/engine";

export type AiFeatureToolSpec = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type StructuredAiFeature =
  | "suggest"
  | "generate_plan"
  | "edit_plan"
  | "conflicts"
  | "timeslots"
  | "dispatch_task";

export type PreparedAiFeatureSpec = {
  feature: StructuredAiFeature;
  instructions: string;
  inputText?: string;
  requiredTool: AiFeatureToolSpec;
  toolChoice: "required";
};

export const SUGGEST_TASK_COMPLETIONS_TOOL_NAME = "suggest_task_completions";
export const ANALYZE_SCHEDULE_CONFLICTS_TOOL_NAME =
  "analyze_schedule_conflicts";
export const SUGGEST_TASK_TIMESLOTS_TOOL_NAME = "suggest_task_timeslots";
export const DISPATCH_NEXT_TASK_ACTION_TOOL_NAME = "dispatch_next_task_action";
export const GENERATE_PLAN_BLUEPRINT_TOOL_NAME = "generate_task_plan_graph";
export const EDIT_PLAN_PATCH_TOOL_NAME = "edit_plan_patch";

export const SUGGEST_TASK_COMPLETIONS_TOOL_DESCRIPTION =
  "Return Chrona task suggestions as structured tool arguments.";

export const ANALYZE_SCHEDULE_CONFLICTS_TOOL_DESCRIPTION =
  "Return Chrona's schedule conflict analysis as structured tool arguments.";

export const SUGGEST_TASK_TIMESLOTS_TOOL_DESCRIPTION =
  "Return Chrona's timeslot suggestions as structured tool arguments.";

export const DISPATCH_NEXT_TASK_ACTION_TOOL_DESCRIPTION =
  "Return Chrona's next task dispatch decision as structured tool arguments.";

export const GENERATE_PLAN_BLUEPRINT_TOOL_DESCRIPTION =
  "Create and persist the Chrona plan blueprint as structured tool arguments.";

export const EDIT_PLAN_PATCH_TOOL_DESCRIPTION =
  "Propose a PlanPatch to edit an existing plan graph. Returns patch operations only, NOT a full graph.";

export const SUGGEST_SYSTEM_PROMPT = `

You are a smart scheduling assistant for a task planning application.
When given a partial task title and context, generate 2-4 task suggestions.
You MUST call the business tool suggest_task_completions.
Put the final suggestions directly into that tool input/result flow.
Tool payload shape:
{"suggestions":[{"title":"...","description":"...","priority":"Low|Medium|High|Urgent","estimatedMinutes":N,"tags":[],"suggestedSlot":{"startAt":"ISO","endAt":"ISO"}}]}
Respond in the same language as the input.`;

export const CONFLICTS_SYSTEM_PROMPT = `

You are a schedule conflict analyzer. Find conflicts and suggest resolutions.
You MUST call the business tool analyze_schedule_conflicts.
Put the final conflict analysis directly into that tool input.
Tool payload shape:
{"conflicts":[{"id":"...","type":"time_overlap|overload|fragmentation|dependency","severity":"low|medium|high","taskIds":[],"description":"..."}],"resolutions":[{"conflictId":"...","type":"reschedule|split|merge|defer|reorder","description":"...","reason":"...","changes":[{"taskId":"...","scheduledStartAt":"...","scheduledEndAt":"..."}]}],"summary":"..."}`;

export const TIMESLOTS_SYSTEM_PROMPT = `

You are a scheduling optimizer. Suggest optimal time slots for a task.
You MUST call the business tool suggest_task_timeslots.
Put the final timeslot suggestions directly into that tool input.
Tool payload shape:
{"slots":[{"startAt":"ISO","endAt":"ISO","score":0.0-1.0,"reason":"..."}],"reasoning":"..."}`;

export const DISPATCH_TASK_SYSTEM_PROMPT = `

You are Chrona's conservative task dispatcher.
Choose exactly one next action and return it via the business tool dispatch_next_task_action.
The dispatch decision must follow schemaName "task_dispatch_decision" and schemaVersion "1.0.0".

Rules:
1. Prefer continuing the accepted plan graph over revising it.
2. Use revise_plan only when execution evidence invalidates or substantially improves the current accepted plan.
3. If required inputs are missing, use ask_user rather than guessing.
4. If safety, dependency, or policy checks are unclear, use stop.
5. Keep decisions incremental (single safe next step).
6. Provide a concise reason and confidence between 0 and 1.
7. Set safety.requiresHumanApproval true when risk is non-trivial.
`;

export const GENERATE_PLAN_SYSTEM_PROMPT = `
You are a task planning assistant that generates concise execution blueprints as directed acyclic graphs (DAGs).
Given a task, produce a structured plan using ONLY these 4 node types: task, checkpoint, condition, wait.
You MUST call the business tool generate_task_plan_graph.
Put the final graph directly into that tool input. Assistant free text is optional and non-authoritative.

## Node types

### task
The core execution unit. Describes WHAT to do, not HOW to do it.
- executor: "ai" (AI/runtime can execute), "user" (human must do it), "system" (deterministic software automation)
- mode: "auto" (fully automatic), "assist" (AI helps but user active), "manual" (user does it)
- Do NOT specify tool calls, API calls, integrations, or AI actions inside the plan node. Those belong to backend/runtime execution.
- If a step needs to call a tool (e.g. create calendar, send email, read context), it is still a task node.
- If a step is high-risk (send message, modify calendar, delete data), insert a checkpoint node BEFORE it with checkpointType: "approve" or "confirm".

### checkpoint
Interaction gate for human confirmation, input, choice, edit, or approval.
- checkpointType: "confirm" (yes/no), "choose" (pick from options), "input" (fill fields), "edit" (modify something), "approve" (sign-off gate)
- prompt: what to show the user
- options: for "choose" type
- inputFields: for "input" type
- required: whether this checkpoint can be skipped

### condition
Branching logic gate that evaluates a condition and routes to different paths.
- condition: human-readable description of the condition (e.g. "Is the weather sunny?")
- evaluationBy: "system" (auto-check), "ai" (AI evaluates), "user" (ask human)
- branches: array of {label, nextNodeId} - at least one required
- defaultNextNodeId: fallback path if no branch matches

### wait
Pause execution for a time duration or external event.
- waitFor: description of what we're waiting for
- timeout: optional {minutes, onTimeout} - what to do if wait exceeds limit
- onTimeout: "continue" (proceed anyway), "pause" (halt indefinitely), "fail" (mark failed), "notify_user" (alert user)

## CRITICAL RULES

1. Plan describes WHAT to do and the flow. Do NOT generate AI actions, tool_action, or integration nodes.
2. id MUST be stable, readable, snake_case (e.g. task_find_time, checkpoint_confirm_plan).
3. Every checkpoint with checkpointType "approve" or "confirm" should directly precede the risky task it gates.
4. Start is expressed via edges (nodes with no incoming edge). End is expressed by nodes with no outgoing edge.
5. Use condition nodes for branching. Each branch.nextNodeId MUST reference a real node id.
6. edges only express main flow connections. Edge shape: {"from": "node_id", "to": "node_id"}.
7. High-risk actions (send message, modify calendar, delete data) MUST have a preceding checkpoint with checkpointType "approve" or "confirm".
8. If you need user input, choice, or confirmation: use checkpoint. Do NOT create separate user_input/decision nodes.
9. If you are at a phase boundary, use a task node with a summary-like title. Do NOT create milestone nodes.
10. Maximize parallelism: independent tasks should not be chained sequentially.

Respond in the same language as the input.`.trim();

export const EDIT_PLAN_PATCH_SYSTEM_PROMPT = `
You are a plan editor. Given an existing plan and a user instruction, propose ONLY a PlanPatch.
Do NOT return a full plan graph — return patch operations using the edit_plan_patch tool.

## Patch operations available
- update_plan: change title, goal, or assumptions
- add_node: add a new task/checkpoint/condition/wait node
- update_node: modify an existing node's fields (NOT its type)
- delete_node: remove a node (associated edges removed automatically)
- add_edge: add a dependency edge (must keep graph a DAG)
- delete_edge: remove an edge
- replace_subgraph: remove nodes and replace with new ones

## Critical rules
1. basePlanId and baseVersion must match the current plan.
2. DO NOT modify runtime fields (status, attempts, toolCalls, artifacts, logs).
3. DO NOT change node.type on existing nodes.
4. Keep existing node IDs stable.
5. New node IDs must be snake_case.
6. Only use node types: task, checkpoint, condition, wait.
7. Provide a rationale for the change.
`.trim();

export const suggestTaskCompletionsToolSpec: AiFeatureToolSpec = {
  type: "function",
  name: SUGGEST_TASK_COMPLETIONS_TOOL_NAME,
  description: SUGGEST_TASK_COMPLETIONS_TOOL_DESCRIPTION,
  parameters: {
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
            suggestedSlot: {
              type: "object",
              additionalProperties: true,
              properties: {
                startAt: { type: "string" },
                endAt: { type: "string" },
              },
            },
          },
          required: ["title"],
        },
      },
    },
    required: ["suggestions"],
  },
};

export const analyzeScheduleConflictsToolSpec: AiFeatureToolSpec = {
  type: "function",
  name: ANALYZE_SCHEDULE_CONFLICTS_TOOL_NAME,
  description: ANALYZE_SCHEDULE_CONFLICTS_TOOL_DESCRIPTION,
  parameters: {
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
};

export const suggestTaskTimeslotsToolSpec: AiFeatureToolSpec = {
  type: "function",
  name: SUGGEST_TASK_TIMESLOTS_TOOL_NAME,
  description: SUGGEST_TASK_TIMESLOTS_TOOL_DESCRIPTION,
  parameters: {
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
};

export const dispatchNextTaskActionToolSpec: AiFeatureToolSpec = {
  type: "function",
  name: DISPATCH_NEXT_TASK_ACTION_TOOL_NAME,
  description: DISPATCH_NEXT_TASK_ACTION_TOOL_DESCRIPTION,
  parameters: {
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

export const generatePlanBlueprintToolSpec: AiFeatureToolSpec = {
  type: "function",
  name: GENERATE_PLAN_BLUEPRINT_TOOL_NAME,
  description: GENERATE_PLAN_BLUEPRINT_TOOL_DESCRIPTION,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        description: "Brief plan title.",
      },
      goal: {
        type: "string",
        description: "What this plan is meant to achieve.",
      },
      assumptions: {
        type: "array",
        items: { type: "string" },
        description: "Optional assumptions the plan relies on.",
      },
      nodes: {
        type: "array",
        description:
          "Execution nodes in dependency order. Provide at least one node.",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: {
              type: "string",
              description: "Stable local id, e.g. node-1.",
            },
            type: {
              type: "string",
              enum: [...AI_PLAN_NODE_TYPES],
            },
            title: {
              type: "string",
              description: "Short node label shown to the user.",
            },
            expectedOutput: {
              type: "string",
              description:
                "What successful completion of this node should produce.",
            },
            completionCriteria: {
              type: "string",
              description: "How to determine the node is done.",
            },
            estimatedMinutes: {
              type: "number",
              description: "Best-effort duration estimate for just this node.",
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
              description:
                "Checkpoint subtype for human confirmation, choice, input, edit, or approval.",
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
            condition: {
              type: "string",
              description: "Human-readable branching condition.",
            },
            evaluationBy: {
              type: "string",
              enum: [...AI_CONDITION_EVALUATORS],
              description: "Who evaluates the condition branch.",
            },
            branches: {
              type: "array",
              description: "Branch targets for a condition node.",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  label: { type: "string" },
                  nextNodeId: { type: "string" },
                },
                required: ["label", "nextNodeId"],
              },
            },
            defaultNextNodeId: {
              type: "string",
              description: "Optional fallback branch target.",
            },
            waitFor: {
              type: "string",
              description:
                "What external event or duration this wait node depends on.",
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
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            label: { type: "string" },
          },
          required: ["from", "to"],
        },
      },
    },
    required: ["title", "goal", "nodes", "edges"],
  },
};

export const editPlanPatchToolSpec: AiFeatureToolSpec = {
  type: "function",
  name: EDIT_PLAN_PATCH_TOOL_NAME,
  description: EDIT_PLAN_PATCH_TOOL_DESCRIPTION,
  parameters: {
    type: "object",
    additionalProperties: true,
    properties: {
      basePlanId: {
        type: "string",
        description: "ID of the plan being edited",
      },
      baseVersion: {
        type: "number",
        description: "Current version for optimistic locking",
      },
      rationale: { type: "string", description: "Why this change is needed" },
      operations: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            op: {
              type: "string",
              enum: [
                "update_plan",
                "add_node",
                "update_node",
                "delete_node",
                "add_edge",
                "delete_edge",
                "replace_subgraph",
              ],
            },
          },
          required: ["op"],
        },
      },
    },
    required: ["basePlanId", "baseVersion", "operations"],
  },
};

export function buildGeneratePlanFeatureInputText(
  input: GenerateTaskPlanRequest,
): string {
  const parts: string[] = [
    "Create a concise plan blueprint for the task below.",
    "Do not ask follow-up questions.",
    "Make reasonable assumptions if the task is underspecified.",
    "The plan should be concise but actionable: 3-7 nodes for normal tasks, with clear dependencies.",
    "Prefer automatic execution nodes when no human approval/input is truly required.",
    "",
    "Task to plan",
  ];

  if (input.title.trim()) {
    parts.push(`Title: ${input.title.trim()}`);
  }
  if (input.description?.trim()) {
    parts.push(`Description: ${input.description.trim()}`);
  }
  if (typeof input.estimatedMinutes === "number") {
    parts.push(`Estimated duration: ${input.estimatedMinutes} minutes`);
  }

  return parts.join("\n");
}

export function buildGeneratePlanFeatureSpec(
  input: GenerateTaskPlanRequest,
): PreparedAiFeatureSpec {
  return {
    feature: "generate_plan",
    instructions: GENERATE_PLAN_SYSTEM_PROMPT,
    inputText: buildGeneratePlanFeatureInputText(input),
    requiredTool: generatePlanBlueprintToolSpec,
    toolChoice: "required",
  };
}

export interface EditPlanFeatureInput {
  planId: string;
  version: number;
  title: string;
  goal: string;
  nodes: Array<{ id: string; type: string; title: string }>;
  edges: Array<{ from: string; to: string }>;
  userInstruction: string;
}

export function buildEditPlanPatchFeatureInputText(
  input: EditPlanFeatureInput,
): string {
  const lines: string[] = [
    "Edit the existing plan according to the user instruction below.",
    "",
    "Current plan:",
    `ID: ${input.planId}`,
    `Version: ${input.version}`,
    `Title: ${input.title}`,
    `Goal: ${input.goal}`,
    "",
    "Nodes:",
    ...input.nodes.map((n) => `  - ${n.id} [${n.type}] ${n.title}`),
    "",
    "Edges:",
    ...input.edges.map((e) => `  ${e.from} -> ${e.to}`),
    "",
    "User instruction:",
    input.userInstruction,
  ];
  return lines.join("\n");
}

export function buildEditPlanPatchFeatureSpec(
  input: EditPlanFeatureInput,
): PreparedAiFeatureSpec {
  return {
    feature: "edit_plan",
    instructions: EDIT_PLAN_PATCH_SYSTEM_PROMPT,
    inputText: buildEditPlanPatchFeatureInputText(input),
    requiredTool: editPlanPatchToolSpec,
    toolChoice: "required",
  };
}

export function buildSuggestFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "suggest",
    instructions: SUGGEST_SYSTEM_PROMPT,
    requiredTool: suggestTaskCompletionsToolSpec,
    toolChoice: "required",
  };
}

export function buildAnalyzeConflictsFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "conflicts",
    instructions: CONFLICTS_SYSTEM_PROMPT,
    requiredTool: analyzeScheduleConflictsToolSpec,
    toolChoice: "required",
  };
}

export function buildSuggestTimeslotsFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "timeslots",
    instructions: TIMESLOTS_SYSTEM_PROMPT,
    requiredTool: suggestTaskTimeslotsToolSpec,
    toolChoice: "required",
  };
}

export function buildDispatchTaskFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "dispatch_task",
    instructions: DISPATCH_TASK_SYSTEM_PROMPT,
    requiredTool: dispatchNextTaskActionToolSpec,
    toolChoice: "required",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateSuggestPayload(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.suggestions)) {
    return {
      ok: false as const,
      error: "Feature 'suggest' payload.suggestions must be an array",
    };
  }
  for (const suggestion of payload.suggestions) {
    if (
      !isRecord(suggestion) ||
      typeof suggestion.title !== "string" ||
      !suggestion.title.trim()
    ) {
      return {
        ok: false as const,
        error: "Feature 'suggest' suggestions must include a non-empty title",
      };
    }
  }
  return { ok: true as const };
}

function validateConflictsPayload(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.conflicts)) {
    return {
      ok: false as const,
      error: "Feature 'conflicts' payload.conflicts must be an array",
    };
  }
  if (!Array.isArray(payload.resolutions)) {
    return {
      ok: false as const,
      error: "Feature 'conflicts' payload.resolutions must be an array",
    };
  }
  if (typeof payload.summary !== "string") {
    return {
      ok: false as const,
      error: "Feature 'conflicts' payload.summary must be a string",
    };
  }
  return { ok: true as const };
}

function validateTimeslotsPayload(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.slots)) {
    return {
      ok: false as const,
      error: "Feature 'timeslots' payload.slots must be an array",
    };
  }
  if (
    payload.reasoning !== undefined &&
    typeof payload.reasoning !== "string"
  ) {
    return {
      ok: false as const,
      error:
        "Feature 'timeslots' payload.reasoning must be a string when provided",
    };
  }
  return { ok: true as const };
}

function validateDispatchTaskPayload(payload: Record<string, unknown>) {
  if (payload.schemaName !== "task_dispatch_decision") {
    return {
      ok: false as const,
      error:
        "Feature 'dispatch_task' schemaName must be task_dispatch_decision",
    };
  }
  if (payload.schemaVersion !== "1.0.0") {
    return {
      ok: false as const,
      error: "Feature 'dispatch_task' schemaVersion must be 1.0.0",
    };
  }
  if (typeof payload.action !== "string" || !payload.action.trim()) {
    return {
      ok: false as const,
      error: "Feature 'dispatch_task' action must be a non-empty string",
    };
  }
  const safety = payload.safety;
  if (!isRecord(safety)) {
    return {
      ok: false as const,
      error: "Feature 'dispatch_task' safety must be an object",
    };
  }
  if (typeof safety.requiresHumanApproval !== "boolean") {
    return {
      ok: false as const,
      error:
        "Feature 'dispatch_task' safety.requiresHumanApproval must be boolean",
    };
  }
  if (!["low", "medium", "high"].includes(String(safety.riskLevel))) {
    return {
      ok: false as const,
      error:
        "Feature 'dispatch_task' safety.riskLevel must be low, medium, or high",
    };
  }
  if (
    typeof payload.confidence !== "number" ||
    payload.confidence < 0 ||
    payload.confidence > 1
  ) {
    return {
      ok: false as const,
      error:
        "Feature 'dispatch_task' confidence must be a number between 0 and 1",
    };
  }
  if (typeof payload.reason !== "string" || !payload.reason.trim()) {
    return {
      ok: false as const,
      error: "Feature 'dispatch_task' reason must be a non-empty string",
    };
  }
  return { ok: true as const };
}

export function validatePreparedFeaturePayload(
  spec: PreparedAiFeatureSpec,
  payload: unknown,
): { ok: true } | { ok: false; error: string } {
  if (!isRecord(payload)) {
    return {
      ok: false,
      error: `Feature '${spec.feature}' returned an invalid payload`,
    };
  }

  switch (spec.feature) {
    case "generate_plan": {
      try {
        normalizeGeneratePlanResponse(payload);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
    case "suggest":
      return validateSuggestPayload(payload);
    case "conflicts":
      return validateConflictsPayload(payload);
    case "timeslots":
      return validateTimeslotsPayload(payload);
    case "dispatch_task":
      return validateDispatchTaskPayload(payload);
    default:
      return {
        ok: false,
        error: `Feature '${spec.feature}' is not supported by the shared feature validator`,
      };
  }
}

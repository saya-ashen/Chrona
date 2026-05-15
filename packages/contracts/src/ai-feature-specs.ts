import type {
  GenerateTaskPlanRequest,
  NodeResultOutput,
} from "./ai-plan-runtime";
import {
  planBlueprintSchema,
  planPatchSchema,
} from "./ai-plan-blueprint";
import { taskDispatchDecisionSchema } from "./ai-dispatch-types";
import { z } from "zod";

export type AiFeatureToolSpec = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AiFeatureStructuredOutputSchema = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

export type StructuredAiFeature =
  | "suggest"
  | "generate_plan"
  | "edit_plan"
  | "conflicts"
  | "timeslots"
  | "dispatch_task"
  | "execute_task_node"
  | "evaluate_condition_node"
  | "review_checkpoint_node";

export type PreparedAiFeatureSpec = {
  feature: StructuredAiFeature;
  instructions: string;
  inputText?: string;
  structuredOutputSchema?: AiFeatureStructuredOutputSchema;
  terminalToolName?: string;
};

export const SUGGEST_TASK_COMPLETIONS_TOOL_NAME = "suggest_task_completions";
export const ANALYZE_SCHEDULE_CONFLICTS_TOOL_NAME =
  "analyze_schedule_conflicts";
export const SUGGEST_TASK_TIMESLOTS_TOOL_NAME = "suggest_task_timeslots";
export const DISPATCH_NEXT_TASK_ACTION_TOOL_NAME = "dispatch_next_task_action";
export const GENERATE_PLAN_BLUEPRINT_TOOL_NAME = "chrona_plan_generate";
export const EXECUTE_TASK_NODE_RESULT_TOOL_NAME = "chrona_node_result";
export const EDIT_PLAN_PATCH_TOOL_NAME = "edit_plan_patch";
export const EVALUATE_CONDITION_NODE_RESULT_TOOL_NAME =
  "evaluate_condition_node_result";
export const REVIEW_CHECKPOINT_NODE_RESULT_TOOL_NAME =
  "review_checkpoint_node_result";

export const SUGGEST_TASK_COMPLETIONS_TOOL_DESCRIPTION =
  "Return Chrona task suggestions as structured tool arguments.";

export const ANALYZE_SCHEDULE_CONFLICTS_TOOL_DESCRIPTION =
  "Return Chrona's schedule conflict analysis as structured tool arguments.";

export const SUGGEST_TASK_TIMESLOTS_TOOL_DESCRIPTION =
  "Return Chrona's timeslot suggestions as structured tool arguments.";

export const DISPATCH_NEXT_TASK_ACTION_TOOL_DESCRIPTION =
  "Return Chrona's next task dispatch decision as structured tool arguments.";

export const GENERATE_PLAN_BLUEPRINT_TOOL_DESCRIPTION =
  "Persist the complete Chrona plan graph through the Chrona MCP tool.";

export const EXECUTE_TASK_NODE_RESULT_TOOL_DESCRIPTION =
  "Report the current Chrona execution node result, then stop the current node run.";

export const EDIT_PLAN_PATCH_TOOL_DESCRIPTION =
  "Propose a PlanPatch to edit an existing plan graph. Returns patch operations only, NOT a full graph.";

export const EVALUATE_CONDITION_NODE_RESULT_TOOL_DESCRIPTION =
  "Return the selected branch for one Chrona condition node.";

export const REVIEW_CHECKPOINT_NODE_RESULT_TOOL_DESCRIPTION =
  "Return a recommendation for one Chrona checkpoint node.";

export interface TaskNodeExecutionFeatureInput {
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  attemptId: string;
  contextSnapshotId: string;
  taskId: string;
  planTitle?: string;
  nodeTitle: string;
  nodeObjective: string;
  expectedOutput?: string;
  completionCriteria?: string;
  completedNodeTitles: string[];
  instructions: string;
}

export type TaskNodeAiOutcome =
  | "completed"
  | "blocked"
  | "needs_input"
  | "failed"
  | "external_running";

export interface TaskNodeAiResult {
  outcome: TaskNodeAiOutcome;
  summary: string;
  outputs?: NodeResultOutput[];
  reason?: string;
  prompt?: string;
}

const nodeResultOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    content: z.string().min(1),
    title: z.string().optional(),
  }).strict(),
  z.object({
    kind: z.literal("markdown"),
    content: z.string().min(1),
    title: z.string().optional(),
  }).strict(),
  z.object({
    kind: z.literal("json"),
    value: z.unknown(),
    title: z.string().optional(),
  }).strict(),
  z.object({
    kind: z.literal("file"),
    path: z.string().min(1),
    title: z.string().optional(),
    language: z.string().optional(),
    description: z.string().optional(),
  }).strict(),
  z.object({
    kind: z.literal("artifact"),
    artifactId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
  }).strict(),
  z.object({
    kind: z.literal("command"),
    command: z.string().min(1),
    title: z.string().optional(),
    exitCode: z.number().int().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  }).strict(),
  z.object({
    kind: z.literal("link"),
    href: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
  }).strict(),
]);

export interface ConditionNodeEvaluationFeatureInput {
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  taskId: string;
  planTitle?: string;
  nodeTitle: string;
  condition: string;
  branches: Array<{ label: string; nextNodeId: string }>;
  defaultNextNodeId?: string;
  completedNodeTitles: string[];
  instructions: string;
}

export interface ConditionNodeAiResult {
  selectedBranchLabel: string;
  reason: string;
  confidence?: number;
}

export interface CheckpointNodeReviewFeatureInput {
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  taskId: string;
  planTitle?: string;
  nodeTitle: string;
  checkpointType: string;
  prompt: string;
  options?: string[];
  completedNodeTitles: string[];
  instructions: string;
}

export interface CheckpointNodeAiResult {
  recommendation: "approve" | "request_changes" | "block";
  summary: string;
  reason: string;
}

export const taskNodeAiResultSchema = z.object({
  outcome: z.enum([
    "completed",
    "blocked",
    "needs_input",
    "failed",
    "external_running",
  ]),
  summary: z.string().min(1),
  outputs: z.array(nodeResultOutputSchema).optional(),
  reason: z.string().optional(),
  prompt: z.string().optional(),
}).strict();

export const conditionNodeAiResultSchema = z.object({
  selectedBranchLabel: z.string().min(1),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
}).strict();

export const checkpointNodeAiResultSchema = z.object({
  recommendation: z.enum(["approve", "request_changes", "block"]),
  summary: z.string().min(1),
  reason: z.string().min(1),
}).strict();

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

export const EXECUTE_TASK_NODE_SYSTEM_PROMPT = `
You are Chrona's task-node worker.
Execute or assess only the task node described in the input.
Use Chrona MCP tools exposed by the provider to read context and persist node progress.
The chrona_node_result MCP tool is the authoritative and terminal way to complete, block, or fail the node.
After chrona_node_result succeeds, stop immediately: do not call more tools, do not continue downstream nodes, and do not produce extra assistant work.

Rules:
1. Complete the current node only when the task objective is satisfied, by calling chrona_node_result with status "complete" and concise result data.
2. Ask for user input only when a specific user answer is required.
3. Block the node by calling chrona_node_result with status "blocked" when progress depends on an external condition or unavailable capability.
4. Fail the node by calling chrona_node_result with status "failed" when the node cannot be completed because of an unrecoverable error.
5. Do not propose plan patches or graph traversal.
6. Keep summary concise and evidence-based.
7. Use input.planContext to understand predecessor/successor relationships, but execute only the current node. Do not mark downstream or sibling nodes as completed early.
`.trim();

export const EVALUATE_CONDITION_NODE_SYSTEM_PROMPT = `
You are Chrona's condition evaluator.
Evaluate only the condition node described in the input.
You MUST call the business tool evaluate_condition_node_result.

Rules:
1. Pick exactly one provided branch label.
2. Use the default branch only when no explicit branch matches.
3. Do not invent branch labels or next node ids.
4. Provide a short reason and confidence from 0 to 1.
`.trim();

export const REVIEW_CHECKPOINT_NODE_SYSTEM_PROMPT = `
You are Chrona's checkpoint reviewer.
Review only the checkpoint node described in the input.
You MUST call the business tool review_checkpoint_node_result.

Rules:
1. Recommend "approve" only when the checkpoint criteria are satisfied.
2. Recommend "request_changes" when user edits or clarification are needed.
3. Recommend "block" when approval would be unsafe or impossible.
4. Do not approve on behalf of the user; provide a recommendation only.
`.trim();

export const GENERATE_PLAN_SYSTEM_PROMPT = `
You are a task planning assistant that generates concise execution blueprints as directed acyclic graphs (DAGs).
Given a task, produce a structured plan using ONLY these 4 node types: task, checkpoint, condition, wait.
You MUST call the Chrona MCP tool chrona_plan_generate.
Put the complete final graph directly into that tool input. Assistant free text is optional and non-authoritative.
The tool input MUST be a PlanBlueprint object with title, goal, nodes, and optional edges/assumptions.
Only include fields that belong to the chosen node type. Do NOT copy task-only fields onto checkpoint, condition, or wait nodes.

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
2. id MUST be stable, readable, English ASCII snake_case using only lowercase letters, numbers, and underscores (e.g. task_find_time, checkpoint_confirm_plan).
3. Every checkpoint with checkpointType "approve" or "confirm" should directly precede the risky task it gates.
4. Start is expressed via edges (nodes with no incoming edge). End is expressed by nodes with no outgoing edge.
5. Use condition nodes for branching. Each branch.nextNodeId MUST reference a real node id.
6. edges only express main flow connections. Edge shape: {"from": "node_id", "to": "node_id"}.
7. High-risk actions (send message, modify calendar, delete data) MUST have a preceding checkpoint with checkpointType "approve" or "confirm".
8. If you need user input, choice, or confirmation: use checkpoint. Do NOT create separate user_input/decision nodes.
9. If you are at a phase boundary, use a task node with a summary-like title. Do NOT create milestone nodes.
10. Maximize parallelism: independent tasks should not be chained sequentially.
11. The graph MUST be a DAG: never create cycles, back edges, self-loops, or edges from a later step back to an earlier step.
12. Do NOT model retries, revisions, or "loop until done" by pointing edges back to previous nodes. Use checkpoints, wait nodes, or runtime retry/replan behavior instead.

Respond in the same language as the input.`.trim();

function toProviderJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  // Provider gateways may validate tool schemas with older/default Ajv setups
  // that reject draft-2020-12 metaschema declarations.
  delete jsonSchema.$schema;
  return jsonSchema;
}

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
  parameters: toProviderJsonSchema(taskDispatchDecisionSchema),
};

export const editPlanPatchToolSpec: AiFeatureToolSpec = {
  type: "function",
  name: EDIT_PLAN_PATCH_TOOL_NAME,
  description: EDIT_PLAN_PATCH_TOOL_DESCRIPTION,
  parameters: toProviderJsonSchema(planPatchSchema),
};

export const evaluateConditionNodeResultToolSpec: AiFeatureToolSpec = {
  type: "function",
  name: EVALUATE_CONDITION_NODE_RESULT_TOOL_NAME,
  description: EVALUATE_CONDITION_NODE_RESULT_TOOL_DESCRIPTION,
  parameters: toProviderJsonSchema(conditionNodeAiResultSchema),
};

export const reviewCheckpointNodeResultToolSpec: AiFeatureToolSpec = {
  type: "function",
  name: REVIEW_CHECKPOINT_NODE_RESULT_TOOL_NAME,
  description: REVIEW_CHECKPOINT_NODE_RESULT_TOOL_DESCRIPTION,
  parameters: toProviderJsonSchema(checkpointNodeAiResultSchema),
};

function toStructuredOutputSchema(
  toolSpec: AiFeatureToolSpec,
): AiFeatureStructuredOutputSchema {
  return {
    name: toolSpec.name,
    description: toolSpec.description,
    schema: toolSpec.parameters,
  };
}

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
  if (input.planningPrompt?.trim()) {
    parts.push("", "Additional planning guidance:", input.planningPrompt.trim());
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
    structuredOutputSchema: toStructuredOutputSchema(editPlanPatchToolSpec),
  };
}

export function buildSuggestFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "suggest",
    instructions: SUGGEST_SYSTEM_PROMPT,
    structuredOutputSchema: toStructuredOutputSchema(suggestTaskCompletionsToolSpec),
  };
}

export function buildAnalyzeConflictsFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "conflicts",
    instructions: CONFLICTS_SYSTEM_PROMPT,
    structuredOutputSchema: toStructuredOutputSchema(analyzeScheduleConflictsToolSpec),
  };
}

export function buildSuggestTimeslotsFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "timeslots",
    instructions: TIMESLOTS_SYSTEM_PROMPT,
    structuredOutputSchema: toStructuredOutputSchema(suggestTaskTimeslotsToolSpec),
  };
}

export function buildDispatchTaskFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "dispatch_task",
    instructions: DISPATCH_TASK_SYSTEM_PROMPT,
    structuredOutputSchema: toStructuredOutputSchema(dispatchNextTaskActionToolSpec),
  };
}

export function buildTaskNodeExecutionFeatureInputText(
  input: TaskNodeExecutionFeatureInput,
): string {
  return [
    "Execute or advance the current Chrona task node through provider-exposed Chrona MCP tools.",
    "",
    `Task ID: ${input.taskId}`,
    input.planTitle ? `Plan: ${input.planTitle}` : "",
    `Graph ID: ${input.graphId}`,
    `Node ID: ${input.nodeId}`,
    `Node layer ID: ${input.nodeLayerId}`,
    `Attempt ID: ${input.attemptId}`,
    `Context snapshot ID: ${input.contextSnapshotId}`,
    `Node title: ${input.nodeTitle}`,
    `Objective: ${input.nodeObjective}`,
    input.expectedOutput ? `Expected output: ${input.expectedOutput}` : "",
    input.completionCriteria
      ? `Completion criteria: ${input.completionCriteria}`
      : "",
    input.completedNodeTitles.length > 0
      ? `Already completed: ${input.completedNodeTitles.join(", ")}`
      : "Already completed: none",
    "",
    "Execution instructions:",
    input.instructions,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTaskNodeExecutionFeatureSpec(
  input: TaskNodeExecutionFeatureInput,
): PreparedAiFeatureSpec {
  return {
    feature: "execute_task_node",
    instructions: EXECUTE_TASK_NODE_SYSTEM_PROMPT,
    inputText: buildTaskNodeExecutionFeatureInputText(input),
    terminalToolName: EXECUTE_TASK_NODE_RESULT_TOOL_NAME,
  };
}

export function buildConditionNodeEvaluationFeatureInputText(
  input: ConditionNodeEvaluationFeatureInput,
): string {
  return [
    "Evaluate the current Chrona condition node and return only the selected branch.",
    "",
    `Task ID: ${input.taskId}`,
    input.planTitle ? `Plan: ${input.planTitle}` : "",
    `Graph ID: ${input.graphId}`,
    `Node ID: ${input.nodeId}`,
    `Node layer ID: ${input.nodeLayerId}`,
    `Node title: ${input.nodeTitle}`,
    `Condition: ${input.condition}`,
    "Branches:",
    ...input.branches.map(
      (branch) => `  - ${branch.label} -> ${branch.nextNodeId}`,
    ),
    input.defaultNextNodeId ? `Default next node: ${input.defaultNextNodeId}` : "",
    input.completedNodeTitles.length > 0
      ? `Already completed: ${input.completedNodeTitles.join(", ")}`
      : "Already completed: none",
    "",
    "Evaluation instructions:",
    input.instructions,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildConditionNodeEvaluationFeatureSpec(
  input: ConditionNodeEvaluationFeatureInput,
): PreparedAiFeatureSpec {
  return {
    feature: "evaluate_condition_node",
    instructions: EVALUATE_CONDITION_NODE_SYSTEM_PROMPT,
    inputText: buildConditionNodeEvaluationFeatureInputText(input),
    structuredOutputSchema: toStructuredOutputSchema(evaluateConditionNodeResultToolSpec),
  };
}

export function buildCheckpointNodeReviewFeatureInputText(
  input: CheckpointNodeReviewFeatureInput,
): string {
  return [
    "Review the current Chrona checkpoint node and return only the recommendation.",
    "",
    `Task ID: ${input.taskId}`,
    input.planTitle ? `Plan: ${input.planTitle}` : "",
    `Graph ID: ${input.graphId}`,
    `Node ID: ${input.nodeId}`,
    `Node layer ID: ${input.nodeLayerId}`,
    `Node title: ${input.nodeTitle}`,
    `Checkpoint type: ${input.checkpointType}`,
    `Prompt: ${input.prompt}`,
    input.options?.length ? `Options: ${input.options.join(", ")}` : "",
    input.completedNodeTitles.length > 0
      ? `Already completed: ${input.completedNodeTitles.join(", ")}`
      : "Already completed: none",
    "",
    "Review instructions:",
    input.instructions,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCheckpointNodeReviewFeatureSpec(
  input: CheckpointNodeReviewFeatureInput,
): PreparedAiFeatureSpec {
  return {
    feature: "review_checkpoint_node",
    instructions: REVIEW_CHECKPOINT_NODE_SYSTEM_PROMPT,
    inputText: buildCheckpointNodeReviewFeatureInputText(input),
    structuredOutputSchema: toStructuredOutputSchema(reviewCheckpointNodeResultToolSpec),
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
      const validation = planBlueprintSchema.safeParse(payload);
      if (!validation.success) {
        return {
          ok: false,
          error:
            validation.error.issues[0]?.message ??
            "Feature 'generate_plan' returned an invalid plan payload",
        };
      }
      return { ok: true };
    }
    case "edit_plan": {
      const validation = planPatchSchema.safeParse(payload);
      if (!validation.success) {
        return {
          ok: false,
          error:
            validation.error.issues[0]?.message ??
            "Feature 'edit_plan' returned an invalid patch payload",
        };
      }
      return { ok: true };
    }
    case "suggest":
      return validateSuggestPayload(payload);
    case "conflicts":
      return validateConflictsPayload(payload);
    case "timeslots":
      return validateTimeslotsPayload(payload);
    case "dispatch_task": {
      const validation = taskDispatchDecisionSchema.safeParse(payload);
      if (!validation.success) {
        return {
          ok: false,
          error:
            validation.error.issues[0]?.message ??
            "Feature 'dispatch_task' returned an invalid decision payload",
        };
      }
      return { ok: true };
    }
    case "execute_task_node": {
      const validation = taskNodeAiResultSchema.safeParse(payload);
      if (!validation.success) {
        return {
          ok: false,
          error:
            validation.error.issues[0]?.message ??
            "Feature 'execute_task_node' returned an invalid task node result",
        };
      }
      return { ok: true };
    }
    case "evaluate_condition_node": {
      const validation = conditionNodeAiResultSchema.safeParse(payload);
      if (!validation.success) {
        return {
          ok: false,
          error:
            validation.error.issues[0]?.message ??
            "Feature 'evaluate_condition_node' returned an invalid condition result",
        };
      }
      return { ok: true };
    }
    case "review_checkpoint_node": {
      const validation = checkpointNodeAiResultSchema.safeParse(payload);
      if (!validation.success) {
        return {
          ok: false,
          error:
            validation.error.issues[0]?.message ??
            "Feature 'review_checkpoint_node' returned an invalid checkpoint result",
        };
      }
      return { ok: true };
    }
    default:
      return {
        ok: false,
        error: `Feature '${spec.feature}' is not supported by the shared feature validator`,
      };
  }
}

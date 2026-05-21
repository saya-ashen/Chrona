import type {
  GenerateTaskPlanRequest,
  NodeResultOutput,
} from "./plan-runtime";
import { planBlueprintSchema, planPatchSchema } from "./ai-plan-blueprint";
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
export const EXECUTE_TASK_NODE_RESULT_TOOL_NAME = "chrona_task_complete";
export const CONDITION_NODE_SELECT_TOOL_NAME = "chrona_condition_select";
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
  "Persist the complete Chrona plan graph through the Chrona MCP tool.";

export const EXECUTE_TASK_NODE_RESULT_TOOL_DESCRIPTION =
  "Report the current Chrona execution node result, then stop the current node run.";

export const EDIT_PLAN_PATCH_TOOL_DESCRIPTION =
  "Propose a PlanPatch to edit an existing plan graph. Returns patch operations only, NOT a full graph.";

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
  z
    .object({
      kind: z.literal("text"),
      content: z.string().min(1),
      title: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("markdown"),
      content: z.string().min(1),
      title: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("json"),
      value: z.unknown(),
      title: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("file"),
      path: z.string().min(1),
      title: z.string().optional(),
      language: z.string().optional(),
      description: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("artifact"),
      artifactId: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("command"),
      command: z.string().min(1),
      title: z.string().optional(),
      exitCode: z.number().int().optional(),
      stdout: z.string().optional(),
      stderr: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("link"),
      href: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
    })
    .strict(),
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

export const taskNodeAiResultSchema = z
  .object({
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
  })
  .strict();

export const conditionNodeAiResultSchema = z
  .object({
    selectedBranchLabel: z.string().min(1),
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const checkpointNodeAiResultSchema = z
  .object({
    recommendation: z.enum(["approve", "request_changes", "block"]),
    summary: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

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
Treat the provided input as the current source of truth. Do not call chrona_node_read or chrona_execution_read by default.
Call chrona_node_read only when current node details or result submission actions are missing, ambiguous, or suspected stale.
Call chrona_execution_read only after a Chrona result submission action is rejected/errors, or when overall execution status/recovery actions are needed.
The chrona_task_complete MCP action is the authoritative result submission action for successful task nodes.
After a Chrona result submission action succeeds, stop immediately: do not call more actions, do not continue downstream nodes, and do not produce extra assistant work.

Rules:
1. Complete the current node only when the task objective is satisfied, by calling chrona_task_complete with concise result data. If the objective requires filesystem, shell, browser, network, or code execution capability and that capability is unavailable, call chrona_node_block instead of chrona_task_complete.
2. Ask for user input only when a specific user answer is required.
3. Block the node by calling chrona_node_block when progress depends on an external condition or unavailable capability.
4. Fail the node by calling chrona_node_fail when the node cannot be completed because of an unrecoverable error.
5. Do not propose plan patches or graph traversal.
6. Keep summary concise and evidence-based.
7. Use input.planContext to understand predecessor/successor relationships, but execute only the current node. Do not mark downstream or sibling nodes as completed early.
`.trim();

export const EVALUATE_CONDITION_NODE_SYSTEM_PROMPT = `
You are Chrona's condition evaluator.
Evaluate only the condition node described in the input.
Treat the provided input as the current source of truth. Do not call chrona_node_read or chrona_execution_read by default.
Call chrona_node_read only when current condition details or branch refs are missing, ambiguous, or suspected stale.
Call chrona_execution_read only after a Chrona result submission action is rejected/errors, or when overall execution status/recovery actions are needed.
The chrona_condition_select MCP action is the authoritative result submission action for condition nodes.
When completing the node, include branchRef from input.branchOptions. Never include nextNodeId.
After a Chrona result submission action succeeds, stop immediately: do not call more actions, do not continue downstream nodes, and do not produce extra assistant work.

Rules:
1. Pick exactly one provided branchRef.
2. Never use a default branch from missing fields, natural language, incomplete JSON, or outputs without explicit branchRef.
3. Do not invent branch refs, branch labels, node IDs, or next node IDs.
4. Call chrona_condition_select only after selecting a valid branchRef.
5. Call chrona_node_block when no branch can be selected safely.
`.trim();

export const REVIEW_CHECKPOINT_NODE_SYSTEM_PROMPT = `
You are Chrona's checkpoint reviewer.
Review only the checkpoint node described in the input.
Treat the provided input as the current source of truth. Do not call chrona_node_read or chrona_execution_read by default.
Call chrona_node_read only when current checkpoint details or result submission actions are missing, ambiguous, or suspected stale.
Call chrona_execution_read only after a Chrona result submission action is rejected/errors, or when overall execution status/recovery actions are needed.
Use Chrona MCP result submission actions only to block the node while waiting for user action or fail on unrecoverable errors.
Do not submit checkpoint decisions through MCP. Checkpoint submission is performed by the user in the frontend.
After a Chrona result submission action succeeds, stop immediately: do not call more actions, do not continue downstream nodes, and do not produce extra assistant work.

Rules:
1. Never call or invent a checkpoint submit MCP tool.
2. Block the node by calling chrona_node_block when user input or approval is required.
3. Fail the node by calling chrona_node_fail only when checkpoint review cannot continue.
4. Do not approve, reject, complete, or request changes on behalf of the user.
`.trim();

export const GENERATE_PLAN_SYSTEM_PROMPT = `
You are a task planning assistant that generates concise execution blueprints as directed acyclic graphs (DAGs).
Given a task, produce a structured plan using ONLY these 4 node types: task, checkpoint, condition, wait.
You MUST call the chrona_plan_generate tool.
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
- Each branch.nextNodeId is a directed edge from the condition node to that target, even if the same edge is not listed in edges.

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
12. Condition branches count as graph edges. A branch from condition_check to task_a plus an edge from task_a back to condition_check is a cycle and is invalid.
13. Do NOT model retries, revisions, missing-info loops, or "loop until done" by pointing edges back to previous nodes.
14. If more information is needed, add a checkpoint for that input and then continue to a NEW downstream task such as task_finalize_requirements. Do not route the checkpoint back to an earlier task.
15. Before calling chrona_plan_generate, mentally topologically sort the graph: every edge and branch must point only to a downstream node.
16. This phase is planning only. Do NOT execute or implement the task.

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
  name: EXECUTE_TASK_NODE_RESULT_TOOL_NAME,
  description: EXECUTE_TASK_NODE_RESULT_TOOL_DESCRIPTION,
  parameters: toProviderJsonSchema(taskNodeAiResultSchema),
};

export const reviewCheckpointNodeResultToolSpec: AiFeatureToolSpec = {
  type: "function",
  name: EXECUTE_TASK_NODE_RESULT_TOOL_NAME,
  description: EXECUTE_TASK_NODE_RESULT_TOOL_DESCRIPTION,
  parameters: toProviderJsonSchema(taskNodeAiResultSchema),
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
  if (input.userInstruction?.trim()) {
    parts.push(
      "",
      "User instruction for this plan revision:",
      input.userInstruction.trim(),
    );
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
    structuredOutputSchema: toStructuredOutputSchema(
      suggestTaskCompletionsToolSpec,
    ),
  };
}

export function buildAnalyzeConflictsFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "conflicts",
    instructions: CONFLICTS_SYSTEM_PROMPT,
    structuredOutputSchema: toStructuredOutputSchema(
      analyzeScheduleConflictsToolSpec,
    ),
  };
}

export function buildSuggestTimeslotsFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "timeslots",
    instructions: TIMESLOTS_SYSTEM_PROMPT,
    structuredOutputSchema: toStructuredOutputSchema(
      suggestTaskTimeslotsToolSpec,
    ),
  };
}

export function buildDispatchTaskFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "dispatch_task",
    instructions: DISPATCH_TASK_SYSTEM_PROMPT,
    structuredOutputSchema: toStructuredOutputSchema(
      dispatchNextTaskActionToolSpec,
    ),
  };
}

export function buildTaskNodeExecutionFeatureInputText(
  input: TaskNodeExecutionFeatureInput,
): string {
  return [
    "Execute or advance the current Chrona task node through provider-exposed Chrona MCP tools.",
    "Backend task, graph, node, layer, attempt, and snapshot IDs are intentionally omitted. Use runtime refs only when provided by the node runtime.",
    "",
    input.planTitle ? `Plan: ${input.planTitle}` : "",
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
    "Evaluate the current Chrona condition node and return only the selected branch ref provided by the node runtime.",
    "Backend task, graph, node, layer, and next-node IDs are intentionally omitted. Never infer routing from labels or default branches.",
    "",
    input.planTitle ? `Plan: ${input.planTitle}` : "",
    `Node title: ${input.nodeTitle}`,
    `Condition: ${input.condition}`,
    "Branches are exposed as branchRef values in runtime input, not as next node IDs.",
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
    terminalToolName: CONDITION_NODE_SELECT_TOOL_NAME,
  };
}

export function buildCheckpointNodeReviewFeatureInputText(
  input: CheckpointNodeReviewFeatureInput,
): string {
  return [
    "Review the current Chrona checkpoint node and return only the recommendation.",
    "Backend task, graph, node, and layer IDs are intentionally omitted. Use runtime refs only when provided by the node runtime.",
    "",
    input.planTitle ? `Plan: ${input.planTitle}` : "",
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

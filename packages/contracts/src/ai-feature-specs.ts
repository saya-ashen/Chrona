import type { GenerateTaskPlanRequest } from "./plan-runtime";
import { planBlueprintSchema } from "./ai-plan-blueprint";

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
export const GENERATE_PLAN_BLUEPRINT_TOOL_NAME = "chrona_plan_generate";

export const SUGGEST_TASK_COMPLETIONS_TOOL_DESCRIPTION =
  "Return Chrona task suggestions as structured tool arguments.";

export const GENERATE_PLAN_BLUEPRINT_TOOL_DESCRIPTION =
  "Persist the complete Chrona plan graph through the Chrona MCP tool.";

export const SUGGEST_SYSTEM_PROMPT = `

You are a smart scheduling assistant for a task planning application.
When given a partial task title and context, generate 2-4 task suggestions.
You MUST call the business tool suggest_task_completions.
Put the final suggestions directly into that tool input/result flow.
Tool payload shape:
{"suggestions":[{"title":"...","description":"...","priority":"Low|Medium|High|Urgent","estimatedMinutes":N,"tags":[],"suggestedSlot":{"startAt":"ISO","endAt":"ISO"}}]}
Respond in the same language as the input.`;

export const GENERATE_PLAN_SYSTEM_PROMPT = `
You are a task planning assistant that generates concise execution blueprints as directed acyclic graphs (DAGs).
Given a task, produce a structured plan using ONLY these 4 node types: task, checkpoint, condition, wait.
You MUST call the chrona_plan_generate tool exactly once.
Put the complete final graph directly into that tool input. Assistant free text is optional and non-authoritative.
After chrona_plan_generate returns success/accepted/completed, the planning phase is complete: STOP immediately. Do NOT call chrona_execution_read, chrona_node_* tools, or any other tool. Do NOT start execution.
The tool input MUST be a PlanBlueprint object with title, goal, nodes, and optional edges/assumptions.
Only include fields that belong to the chosen node type. Do NOT copy task-only fields onto checkpoint, condition, or wait nodes.

## Node types

### task
The core execution unit. Describes WHAT to do, not HOW to do it.
- executor: "ai" (AI/runtime can execute), "user" (human must do it), "system" (deterministic software automation)
- mode: "auto" (fully automatic), "assist" (AI helps but user active), "manual" (user does it)
- Do NOT specify tool calls, API calls, integrations, or AI actions inside the node — those are runtime concerns. A step that calls a tool (create calendar, send email, read context) is still a single task node.

### checkpoint
Interaction gate for human confirmation, input, choice, edit, or approval.
- checkpointType: "confirm" (yes/no), "choose" (pick from options), "input" (fill fields), "edit" (modify something), "approve" (sign-off gate)
- prompt: what to show the user; options: for "choose"; inputFields: for "input"; required: whether it can be skipped

### condition
Branching gate that evaluates a condition and routes to different paths.
- condition: human-readable description (e.g. "Is the weather sunny?")
- evaluationBy: "system" (auto-check), "ai" (AI evaluates), "user" (ask human)
- branches: array of {label, nextNodeId}, at least one required; defaultNextNodeId: optional fallback path
- Each branch.nextNodeId is a directed edge from the condition node to that target.

### wait
Pause execution for a duration or external event.
- waitFor: what is being waited for
- timeout: optional {minutes, onTimeout}; onTimeout: "continue" | "pause" | "fail" | "notify_user"

## Sizing — match structure to the task, never pad it

- Use the fewest nodes the task genuinely needs. A simple task may be a SINGLE task node that both does the work and delivers the result.
- Typical tasks use 3-7 nodes. Use more than 8 only for clearly independent phases, required approvals, external waits, or real branching.
- Do not split one coherent action into micro-nodes; keep tightly coupled work in one task node.
- Prefer a mostly linear graph. Use parallelism only for clearly independent work.
- Add a node only if it changes execution state, gathers required user input, waits for an external event, branches the flow, gates real risk, or delivers the result. Otherwise remove or merge it.

## Minimize user friction

- Do not interrupt the user unless correctness, safety, or a genuine user decision requires it.
- Do not add checkpoints for low-risk internal progress reviews, status updates, summaries, or "verify before continuing" steps.
- High-risk actions (send message, modify calendar, delete data) MUST have an immediately preceding checkpoint with checkpointType "approve" or "confirm".
- When user input is needed, use the least-effort checkpoint: "confirm" for yes/no, "choose" when options are known, "input" only for truly free-form fields, "edit" only when the user must modify generated content. Prefer bounded choices over free-form input. Always express user input/choice/confirmation as a checkpoint — never invent separate user_input or decision nodes.

## Delivering the result

- Execution must end by delivering the task result to the user. The final task node produces the user-facing deliverable directly through its outputs.
- Do NOT add a separate node whose only purpose is to summarize, present, or hand off a result that an existing task node already produces. For a simple task, the work node IS the delivery node.
- A plan must NOT end on a checkpoint, approval, confirmation, review, condition, wait, or routing node — those do not deliver a result. End on the task node that completes the work.
- If the flow branches, every successful path must end by delivering its result; converge paths into a shared final node only when that reflects the real work, not for bookkeeping.

## DAG and ID rules

- id MUST be stable, readable, English ASCII snake_case using only lowercase letters, numbers, and underscores (e.g. task_find_time, checkpoint_confirm_plan).
- The graph MUST be a DAG: no cycles, back edges, or self-loops. Every edge and branch must point to a strictly downstream node. Condition branches count as edges.
- Start is expressed via nodes with no incoming edge; end via nodes with no outgoing edge. edges express main flow as {"from": "node_id", "to": "node_id"}; each branch.nextNodeId must reference a real node id.
- Use dependency edges only for real execution dependencies — if a node does not need another node's output, user decision, approval, or external event, do not make it wait behind that node.
- Do NOT model retries, revisions, or "loop until done" by pointing edges back to earlier nodes. If more information is needed, add a checkpoint and continue to a NEW downstream node.
- Before calling chrona_plan_generate, mentally topologically sort the graph to confirm every edge and branch points only downstream.

This phase is planning only — do NOT execute, implement, inspect execution state, read execution context, or continue after chrona_plan_generate succeeds.
Respond in the same language as the input.`.trim();

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
    "Use as few nodes as the task genuinely needs: a simple task may be a single node; most tasks use 3-7 nodes with clear dependencies.",
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
  if (input.sourceContext?.trim()) {
    parts.push(
      "",
      "Calendar event details (read-only, from the external calendar source):",
      input.sourceContext.trim(),
    );
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

export function buildSuggestFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "suggest",
    instructions: SUGGEST_SYSTEM_PROMPT,
    structuredOutputSchema: toStructuredOutputSchema(
      suggestTaskCompletionsToolSpec,
    ),
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
    case "suggest":
      return validateSuggestPayload(payload);
    default:
      return {
        ok: false,
        error: `Feature '${spec.feature}' is not supported by the shared feature validator`,
      };
  }
}

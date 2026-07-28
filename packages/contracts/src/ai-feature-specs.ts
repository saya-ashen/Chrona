import { z } from "zod";
import { chronaResultSpecJsonSchema } from "@chrona/ui-protocol";
import type { GenerateTaskPlanRequest } from "./plan-runtime";
import { goalAssetOwnershipResultSchema } from "./api/goal-workbench.schema";
import { goalReviewResultSchema } from "./api/goals.schema";
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
  | "review_checkpoint_node"
  | "task.result_finalization"
  | "goal.asset_ownership"
  | "goal.review";

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
You MUST call the chrona_plan_generate tool.
Put the complete final graph directly into that tool input. Assistant free text is optional and non-authoritative.
After chrona_plan_generate returns success/accepted/completed, STOP immediately. Do NOT call chrona_execution_read, chrona_node_* tools, list_mcp_resources, list_mcp_resource_templates, or any execution tools. Do NOT start execution. If chrona_plan_generate is rejected with validation issues, fix the exact graph issues and call chrona_plan_generate again; still do NOT call chrona_execution_read or execution/node tools.
The Task source context may include a complete frozen Goal asset catalog. Each entry is metadata only: opaque GA ref, bounded title and description, purpose role, technical kind, captured formal version, and update time. Do not infer body facts from metadata. Use chrona_goal_results_read with an exact GA ref only when the asset body can materially change the plan graph, required checkpoints, dependencies, or constraints. Read only relevant assets; never traverse the entire catalog indiscriminately. The tool resolves the Task-captured version, so do not ask the user to select assets or versions.
The chrona_plan_generate tool input MUST be a PlanBlueprint object with title, goal, nodes, and optional edges/assumptions.
Only include fields that belong to the chosen node type. Do NOT copy task-only fields onto checkpoint, condition, or wait nodes.

## Node types

### task
The core execution unit. Describes WHAT to do, not HOW to do it.
- executor: "ai" (AI/runtime can execute), "user" (human must do it), "system" (deterministic software automation)
- mode: "auto" (fully automatic), "assist" (AI helps but user active), "manual" (user does it)
- Every task node must set userInteraction to either {level:"not_expected"} or {level:"possible",reason:"..."}.
- Use "possible" when the task can still produce a correct, useful result without user input, but runtime discoveries may reveal an ambiguity, preference, or tradeoff worth asking about. The reason must name that concrete trigger. Do not predefine fields because runtime context determines the request.
- "not_expected" is an expectation, not a restriction: runtime AI may still request input if an unanticipated information gap appears.
- Do NOT specify tool calls, API calls, integrations, or AI actions inside the node — those are runtime concerns. A step that calls a tool (create calendar, send email, read context) is still a single task node.

### checkpoint
Mandatory human interaction gate. Use only when execution must pause for the user regardless of what runtime work discovers.
- interaction.schemaSource: "static" when the complete form is known now; use checkpointType/options/inputFields to define it.
- interaction.schemaSource: "ai" when participation is mandatory but the concrete question, choices, recommendations, or defaults depend on prior execution; include interaction.instruction and do not invent placeholder fields.
- checkpointType: "confirm" (yes/no), "choose" (pick from options), "input" (fill fields), "edit" (modify something), "approve" (sign-off gate)
- prompt: user-facing purpose of the gate; required: whether it can be skipped. For ai-defined checkpoints, Runtime AI constructs the actual request later.

### condition
Branching gate that evaluates a condition and routes to different paths.
- condition: human-readable description (e.g. "Is the weather sunny?")
- evaluationBy: "ai" (AI evaluates from prior node output/context), "user" (ask human)
- branches: array of {label, nextNodeId}, at least one required; defaultNextNodeId: optional fallback path
- Each branch.nextNodeId is a directed edge from the condition node to that target.

### wait
Pause execution for a duration or external event.
- waitFor: what is being waited for
- timeout: optional {minutes, onTimeout}; onTimeout: "continue" | "pause" | "fail" | "notify_user"

## Plan shape — model every necessary state transition

- Choose the graph structure from execution dependencies, not a target node count. A simple task may be one task node; a complex task may use as many nodes as its real work, decisions, required user input, waits, and branches need.
- Keep coherent work together, but never merge across a state boundary: required user participation, approval, an external wait, a branch decision, or independently executable work deserves its own node.
- Prefer a readable graph with meaningful nodes. Remove nodes that only restate, narrate, summarize, or hand off work already owned by another node.
- Add every node needed for correctness even when that makes the plan longer. Do not omit a checkpoint, wait, condition, dependency, or final consuming task merely to keep the graph compact.

## User participation — distinguish optional help from required facts

- Do not interrupt the user for low-risk progress reviews, status updates, internal implementation choices, or information the runtime can reliably obtain itself.
- Use task userInteraction.level "possible" only when execution can produce a correct and useful result without the user response. It may improve or personalize the result, but it must not be a hidden prerequisite for completion.
- Use a required checkpoint when correctness or the requested deliverable depends on user-only facts, preferences, authorization, approval, or a genuine decision that is absent from the provided context.
- Personalized, factual, submission-ready, identity-dependent, or user-specific deliverables require a checkpoint before the task that consumes missing user facts. A generic template, placeholders, assumptions about the user, or a list of missing information does NOT satisfy such completion criteria unless the user explicitly requested a template or draft with placeholders.
- Prefer one focused checkpoint that collects the related required input together. Use interaction.schemaSource "ai" when prior execution determines the concrete questions, choices, recommendations, or defaults; use "static" only when the complete form is already known.
- For static checkpoints, use the least-effort accurate form: confirm for yes/no, choose for known options, input for truly free-form fields, and edit when the user must modify known content. Never use a generic placeholder textarea when runtime results should determine the form.

## Delivering the result

- Execution must end by delivering the task result to the user. The final task node produces the user-facing deliverable directly through its outputs.
- Do NOT add a separate node whose only purpose is to summarize, present, or hand off a result that an existing task node already produces. For a simple task, the work node IS the delivery node.
- A plan must NOT end on a checkpoint, approval, confirmation, review, condition, wait, or routing node — those do not deliver a result. End on the one task node that completes the work.
- If the flow branches, every successful path must converge to the single final task node. Do NOT create separate final success/fallback delivery nodes unless the task explicitly asks for separate artifacts; merge fallback handling into the shared final task or route it into the shared final task.

## DAG and ID rules

- id MUST be stable, readable, English ASCII snake_case using only lowercase letters, numbers, and underscores (e.g. task_find_time, checkpoint_confirm_plan).
- The graph MUST be a DAG: no cycles, back edges, or self-loops. Every edge and branch must point to a strictly downstream node. Condition branches count as edges.
- Start is expressed via nodes with no incoming edge; end via nodes with no outgoing edge. edges express main flow as {"from": "node_id", "to": "node_id"}; each branch.nextNodeId must reference a real node id.
- Every edges[].from, edges[].to, branch.nextNodeId, defaultNextNodeId, and timeout.onTimeout target MUST exactly match one of nodes[].id. Never reference a helper or capability-check id unless that exact node exists in nodes[].
- Use dependency edges only for real execution dependencies — if a node does not need another node's output, user decision, approval, or external event, do not make it wait behind that node.
- Do NOT model retries, revisions, or "loop until done" by pointing edges back to earlier nodes. If more information is needed, add a checkpoint and continue to a NEW downstream node.
- Before calling chrona_plan_generate, mentally topologically sort the graph to confirm every edge and branch points only downstream.
- Exactly one node may have no outgoing edge after accounting for condition branches/defaults, and that terminal node MUST be a task.
- Every non-terminal node must have at least one outgoing edge or condition branch/default target. Do NOT leave retry, fallback, empty-result, or explanatory nodes unconnected.
- Checkpoint options are labels for user choices only; they do NOT create control-flow. If a choice should run work, add explicit downstream edges to existing nodes and still converge to the single final task.

This phase is planning only — do not execute or inspect execution state. You may use the read-only chrona_goal_results_read tool only for relevant frozen Goal knowledge whose body can materially change the plan. Do not continue after chrona_plan_generate succeeds.
Respond in the same language as the input.`.trim();

export type GeneratePlanFeatureSpecOptions = {
  providerType?: string;
};

export const CODEX_GENERATE_PLAN_DISCOVERY_PROMPT = `
Codex provider note: MCP tools may be deferred behind tool_search. If chrona_plan_generate is not visible in the current tool list, first call tool_search with query "chrona_plan_generate", then call the discovered chrona_plan_generate tool. Do not use list_mcp_resources, list_mcp_resource_templates, or read_mcp_resource for plan generation.
`.trim();

function buildGeneratePlanInstructions(
  options?: GeneratePlanFeatureSpecOptions,
): string {
  if (options?.providerType === "codex") {
    return `${GENERATE_PLAN_SYSTEM_PROMPT}\n\n${CODEX_GENERATE_PLAN_DISCOVERY_PROMPT}`;
  }
  return GENERATE_PLAN_SYSTEM_PROMPT;
}

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

function currentPlanRevisionText(input: GenerateTaskPlanRequest) {
  const context = input.revisionContext;
  if (!context) return null;

  return JSON.stringify(
    {
      planId: context.planId,
      status: context.status,
      revision: context.revision,
      summary: context.summary,
      selectedNodeId: context.selectedNodeId ?? null,
      blueprint: context.blueprint,
    },
    null,
    2,
  );
}

export function buildGeneratePlanFeatureInputText(
  input: GenerateTaskPlanRequest,
): string {
  const parts: string[] = [
    input.revisionContext
      ? "Revise the current draft plan instead of starting from a blank plan. Preserve unchanged good parts. Apply the user request to the selected node when selectedNodeId is set; otherwise apply it to the whole plan. Return the full revised plan blueprint."
      : "Create an execution plan blueprint for the task below.",
    "Do not ask follow-up questions during planning; represent mandatory participation as a checkpoint in the plan.",
    "Make only assumptions that do not invent user-specific facts or weaken the requested deliverable.",
    "Choose nodes from real execution work and state transitions. A simple task can be one node, while required input, approvals, waits, branches, or independent dependencies require explicit nodes.",
    "Prefer automatic execution where it remains correct; never omit required human input merely to make the plan shorter or more automatic.",
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
      "Source context (read-only; provenance is preserved in the payload):",
      input.sourceContext.trim(),
    );
  }
  if (typeof input.estimatedMinutes === "number") {
    parts.push(`Estimated duration: ${input.estimatedMinutes} minutes`);
  }
  const currentPlanText = currentPlanRevisionText(input);
  if (currentPlanText) {
    parts.push(
      "",
      "Current draft plan JSON (read-only baseline for revision):",
      currentPlanText,
    );
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
  options?: GeneratePlanFeatureSpecOptions,
): PreparedAiFeatureSpec {
  return {
    feature: "generate_plan",
    instructions: buildGeneratePlanInstructions(options),
    inputText: buildGeneratePlanFeatureInputText(input),
    terminalToolName: GENERATE_PLAN_BLUEPRINT_TOOL_NAME,
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

export function buildGoalAssetOwnershipFeatureSpec(): PreparedAiFeatureSpec {
  return {
    feature: "goal.asset_ownership",
    instructions:
      "You classify one accepted task result into a frozen set of Goal asset candidates. Use only the supplied snapshot. Return one discrete ownership decision with evidence and counter-evidence. Never create, modify, archive, or publish assets.",
    structuredOutputSchema: {
      name: "goal_asset_ownership_result",
      description:
        "A bounded recommendation for the ownership of one Goal Inbox candidate.",
      schema: z.toJSONSchema(goalAssetOwnershipResultSchema, {
        target: "draft-07",
        unrepresentable: "any",
      }) as Record<string, unknown>,
    },
  };
}

export function buildResultFinalizationFeatureSpec(input: {
  manifest: unknown;
}): PreparedAiFeatureSpec {
  return {
    feature: "task.result_finalization",
    instructions: [
      "You are Chrona's restricted result finalizer.",
      "Transform the supplied immutable ResultManifest into one concise, operational Chrona result workspace. The manifest is semantic source material, not a page outline. Do not reproduce it as a linear report or map its arrays one-to-one into sections.",
      "Do not invent facts, numbers, paths, URLs, artifact identities, task IDs, run IDs, provider data, execution status, or readiness. Every statement and metric must be directly supported by the manifest.",
      "Return one complete validated Spec. Do not call tools, request input, emit actions, or use dynamic state bindings.",
      "Choose the information architecture from the user's likely result task: reading, comparing, deciding, inspecting data, applying a deliverable, reviewing changes, following a timeline, or a justified mixture. This intent guides composition but never selects a fixed template. The root may be any container that owns the whole composition.",
      "Use ResultOverview for the editorial lead in ordinary results. Legacy ResultHero is allowed only when readiness itself is the result's dominant message, not as the default first block. Keep the overview title under 96 characters and synthesize its summary from manifest.outcome rather than copying a long node summary into the title.",
      "If readiness is ready_with_caveats, partial, or blocked, render ResultReadiness as its own visible component wherever the limitation affects interpretation or action. Do not hide non-ready semantics inside a hero badge or evidence appendix.",
      "Use ResultSection to create meaningful regions with stack, grid, split, or rail layout. Use ResultComparison for bounded option trade-offs, ResultTimeline for dates or ordered milestones, ResultChecklist for operational steps, ResultMetricGrid only for exact manifest-supported values, and ResultChangeSummary for concrete code, configuration, or document changes.",
      "Use ResultDeliverable only for current deliverables worth featuring in the narrative and set artifactRef to its opaque manifest artifactRef. At most one may have role primary and at most three deliverables may appear in the Spec. The host independently exposes all generated Artifacts, so omit supporting files that add no decision value. Never repeat artifactRefs or expose paths as prose.",
      "Legacy ResultInsight, ResultActionPlan, ResultCaveats, ResultEvidence, and ResultHero exist for persisted result compatibility. Prefer ResultSection, ResultComparison, ResultTimeline, ResultChecklist, ResultReadiness, and CollapsibleBlock in newly finalized results. Do not emit more than two legacy ResultInsight blocks, and do not recreate the sequence Hero → Deliverables → Insights → ActionPlan → Caveats → Evidence.",
      "Use RichMarkdown, Table, JsonView, Card, Heading, Text, Badge, Alert, Separator, FileRef, ResultSummary, CollapsibleText, and CollapsibleBlock when their semantics fit. Do not wrap every item in a card and do not generate more than two consecutive isomorphic blocks when a comparison, collection, or synthesis is clearer.",
      "Every element that states, transforms, or summarizes manifest content MUST set sourceKeys to the exact manifest keys it covers. Valid keys are deliverableKey values plus finding, decision, caveat, nextAction, and evidence keys. Elements containing only manifest.outcome or manifest.readiness may omit sourceKeys.",
      "Preserve material caveats visibly before any affected recommendation or action. If readiness is ready_with_caveats, partial, or blocked, never describe the result as unconditionally ready. Evidence and raw diagnostic detail should normally be collapsed and subordinate.",
      "Keep the first viewport useful: a concise outcome, the main decision/content/deliverable, and any limitation needed to use it safely. Keep the complete Spec under 48 elements, nesting at most five levels, and avoid long prose when a comparison, checklist, timeline, metric group, or Artifact preview expresses the result better.",
      "Examples of valid variation: a research result may lead with ResultOverview, a ResultComparison of the strongest findings, and one primary document; a shortlist may lead with ResultComparison and ResultTimeline; a code task may lead with ResultChangeSummary and ResultChecklist; a data task may lead with ResultMetricGrid and a file-backed Table; a media task may lead with selected deliverables. These are examples, not templates.",
    ].join("\n"),
    inputText: JSON.stringify({ manifest: input.manifest }, null, 2),
    structuredOutputSchema: {
      name: "chrona_finalized_result_spec",
      description: "One complete Chrona json-render result workspace.",
      schema: chronaResultSpecJsonSchema as Record<string, unknown>,
    },
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
    case "goal.asset_ownership": {
      const validation = goalAssetOwnershipResultSchema.safeParse(payload);
      if (!validation.success) {
        return {
          ok: false,
          error:
            validation.error.issues[0]?.message ??
            "Feature 'goal.asset_ownership' returned an invalid proposal payload",
        };
      }
      return { ok: true };
    }
    case "goal.review": {
      const validation = goalReviewResultSchema.safeParse(payload);
      if (!validation.success) {
        return {
          ok: false,
          error:
            validation.error.issues[0]?.message ??
            "Feature 'goal.review' returned an invalid proposal payload",
        };
      }
      return { ok: true };
    }
    case "execute_task_node":
    case "evaluate_condition_node":
    case "review_checkpoint_node":
      return {
        ok: false,
        error: `Feature '${spec.feature}' is not supported by the shared feature validator`,
      };
    default:
      return {
        ok: false,
        error: `Feature '${spec.feature}' is not supported by the shared feature validator`,
      };
  }
}

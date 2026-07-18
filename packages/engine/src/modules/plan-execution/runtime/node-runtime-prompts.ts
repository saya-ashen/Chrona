import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  NodeRuntimeInput,
  PlanOutputState,
} from "@chrona/contracts/ai";
import { chronaPlanOutputCatalogPrompt } from "@chrona/ui-protocol";

import { buildNodeRuntimeInput } from "./node-runtime-refs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getChronaGeneratedFilesDir } from "@chrona/shared/data-paths";

export const NODE_RUNTIME_TERMINAL_TOOLS = {
  task: [
    "chrona_plan_output",
    "chrona_node_complete",
    "chrona_node_request_input",
    "chrona_node_block",
    "chrona_node_fail",
  ],
  condition: [
    "chrona_condition_select",
    "chrona_node_block",
    "chrona_node_fail",
  ],
  checkpoint: ["chrona_node_request_input", "chrona_node_block", "chrona_node_fail"],
  wait: ["chrona_wait_complete", "chrona_node_block", "chrona_node_fail"],
} as const;

const NODE_RUNTIME_PROTOCOL = `
You are Chrona's node runtime worker.
Chrona backend owns real task, plan, graph, node, and layer IDs.
Use only AI-visible refs from runtime input: node.ref and branchOptions[].ref.
You must never invent or emit backend IDs.
Do not call chrona_node_read or chrona_execution_read by default.
Call chrona_node_read only when the current node details, result submission actions, or branch refs are missing, ambiguous, or suspected stale.
Call chrona_execution_read only after a Chrona result submission action is rejected/errors, or when overall execution status/recovery actions are needed.
Use context.plan.goal and context.plan.assumptions as the global objective and constraints for the current node. If context.run is present, treat it as initial run-level planning context and do not repeat it in node outputs.
Call chrona_node_request_input when normal execution needs structured user input. Keep chrona_node_block for exceptional external blockers such as missing access or unavailable capability. A request-input form uses only text, choice, and boolean field kinds; choice.selection distinguishes single from multiple selection.
After chrona_node_complete, chrona_condition_select, chrona_wait_complete, chrona_node_request_input, chrona_node_block, or chrona_node_fail succeeds, stop immediately. Do not continue downstream nodes.
`.trim();

const PLAN_OUTPUT_CATALOG_PROMPT = chronaPlanOutputCatalogPrompt();
const RESULTS_DESIGN_BRIEF = `
Design user-visible Results as a concise deliverable, not a raw data dump. Help the user understand what was completed, the most important findings, the primary data or report needed to inspect the result, and where full artifacts or evidence live.

Choose components based on the result shape: use ResultSummary for the outcome, Markdown or Card for interpretation, caveats, and key findings, Table for ranked lists, comparisons, records, and datasets users need to scan, FileRef or FileView for full artifacts, and JsonView only for diagnostics or machine-readable evidence.

For Tables, choose columns that best explain the data for the user's goal. Prefer readable, semantic fields over implementation fields. Do not mechanically include every field. Do not drop fields that explain why a row matters. When a row name or title has a URL, prefer making the name or title a link when that reads better than a standalone URL column.

Keep Results rich enough to be useful, but avoid duplicating the same information across summaries, tables, and files.
`.trim();

function resultArtifactGuidance(runtimeInput: NodeRuntimeInput): string {
  const generatedFiles = runtimeInput.context.run?.generatedFiles;
  if (!generatedFiles) return "";
  return `For generated result artifacts not explicitly requested as repo/code changes, write only under the absolute output directory ${generatedFiles.directory}. Reference those files from plan output with FileView or FileRef using ${generatedFiles.referenceBase}<filename>, not the absolute path. For long Markdown reports or large evidence, prefer a .md/.txt/.json/.csv file there. Keep ResultSummary/Card/Markdown/Table as the readable summary; do not dump long report bodies directly into chrona_plan_output patches. Do not use .. segments, secrets/tokens/credentials/key paths, backend IDs, or paths outside the assigned output directory for generated deliverables.`;
}

function generatedFilesContext(nodeRef: string) {
  const scope = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const directory = join(getChronaGeneratedFilesDir(), scope, nodeRef);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return {
    directory,
    referenceBase: `generated://${scope}/${nodeRef}/`,
  };
}

const PLAN_OUTPUT_UPDATE_EXAMPLE = JSON.stringify({
  patches: [
    {
      op: "add",
      path: "/elements/marketSummary",
      value: {
        type: "Card",
        props: { title: "Market summary" },
        children: ["marketSummaryBody"],
      },
    },
    {
      op: "add",
      path: "/elements/marketSummaryBody",
      value: {
        type: "RichMarkdown",
        props: { content: "## Key findings\n\n- Finding one\n- Finding two" },
        children: [],
      },
    },
    {
      op: "add",
      path: "/elements/<currentRootId>/children/-",
      value: "marketSummary",
    },
  ],
  summary: "Added market summary section",
}, null, 2);

function nodeTypeInstructions(node: EffectivePlanNode): string {
  switch (node.type) {
    case "task":
      return `When the current task-node has user-visible deliverables, call chrona_plan_output with RFC 6902 SpecStream patches before completion. Generate UI using only the Chrona plan-output catalog (see CATALOG_UI_SPEC below). chrona_plan_output edits one task-level plan output shared by every node in this task run; each call patches the same accumulated result, not a node-local document. Call chrona_node_complete only when the current task-node objective is fully satisfied and required output patches have succeeded. If the objective requires filesystem, shell, browser, network, or code execution capability you do not have, block instead of pretending completion.

      Read Current Node Context JSON.context.planOutput before patching. If context.planOutput.hasSpec is false, bootstrap once with /root and every required /elements/<id> entry in the same chrona_plan_output call. If context.planOutput.hasSpec is true, NEVER patch /root, /elements, or replace the existing root element; preserve context.planOutput.root and append node-specific sections under that existing layout. Existing element ids are summarized in context.planOutput.elementIds; existing root children are summarized in context.planOutput.rootChildren.

      For later user-visible deliverables, pass "patches" as incremental JSON Patch operations. RichMarkdown.content is an ordinary Markdown string. Follow this valid JSON argument example:\n${PLAN_OUTPUT_UPDATE_EXAMPLE}

      Final Spec after applying patches must be valid and closed: root must reference an existing element id, every child id referenced in any children array must exist as an element id, every element id must be unique, and no element may be omitted as a placeholder unless that element is also declared in elements. For existing plan output, satisfy these rules by preserving the current root and adding/appending elements; do not rebuild the whole Spec.

      Spec hard rules, all enforced by validation: (1) root MUST equal one element id. (2) Leaf elements use children: []. (3) children contains child element-id strings only. (4) Every child id MUST exist in elements. (5) No element may include itself or create a cycle. (6) Component type MUST be from CATALOG_UI_SPEC. (7) props MUST match that component schema exactly. (8) visible is an element-level field, not a prop. (9) The plan-output catalog is intentionally small: use Stack/Card/Heading/Text/RichMarkdown/Table/Badge/Alert/FileRef/JsonView/ResultSummary/CollapsibleText/Separator only.`;
    case "condition":
      return `Evaluate exactly one listed branch and call chrona_condition_select with branchRef. Do not use labels, nextNodeId, default branches, natural-language conclusions, or incomplete JSON as routing authority. If no explicit branchRef is safe, call chrona_node_block.`;
    case "checkpoint": {
      const config = node.config as { required?: boolean; interaction?: { schemaSource?: string; instruction?: string } };
      if (config.interaction?.schemaSource === "ai") {
        return `This is a required AI-defined human interaction gate. Use prior execution context and results to decide the concrete question, field kinds, choices, recommendations, and defaults. You MUST call chrona_node_request_input with a concise validated form; do not call chrona_node_complete and do not substitute chrona_node_block. Planning instruction: ${config.interaction.instruction ?? node.title}`;
      }
      return `Review only the current checkpoint context. Do not submit checkpoint decisions: Checkpoint submission is performed by the user in the frontend. Call chrona_node_request_input when structured user input is required, chrona_node_block only for an exceptional external blocker, and chrona_node_fail only for unrecoverable errors.`;
    }
    case "wait":
      return `Complete only when the wait condition is satisfied by explicit evidence. Otherwise block or fail with a concise reason.`;
  }
}

function runtimeJson(runtimeInput: NodeRuntimeInput): string {
  return JSON.stringify(runtimeInput, null, 2);
}

export function buildNodeRuntimePrompt(input: {
  plan: EffectivePlanGraph;
  node: EffectivePlanNode;
  planOutput?: PlanOutputState | NodeRuntimeInput["context"]["planOutput"];
  planContext?: NodeRuntimeInput["context"]["plan"];
  runContext?: NonNullable<NodeRuntimeInput["context"]["run"]>;
}): { instructions: string; runtimeInput: NodeRuntimeInput } {
  const currentNodeResultActionNames = [
    ...NODE_RUNTIME_TERMINAL_TOOLS[input.node.type],
  ];
  const baseRuntimeInput = buildNodeRuntimeInput({
    plan: input.plan,
    node: input.node,
    planOutput: input.planOutput,
    planContext: input.planContext,
    runContext: input.runContext,
  });
  const runtimeInput: NodeRuntimeInput = input.node.type === "task"
    ? {
        ...baseRuntimeInput,
        context: {
          ...baseRuntimeInput.context,
          run: {
            ...baseRuntimeInput.context.run,
            generatedFiles: generatedFilesContext(baseRuntimeInput.node.ref),
          },
        },
      }
    : baseRuntimeInput;

  const catalogSection =
    input.node.type === "task"
      ? [
          RESULTS_DESIGN_BRIEF,
          resultArtifactGuidance(runtimeInput),
          PLAN_OUTPUT_CATALOG_PROMPT,
        ]
      : [];

  const instructions = [
    NODE_RUNTIME_PROTOCOL,
    nodeTypeInstructions(input.node),
    `When task-node work produces deliverables, submit them with chrona_plan_output first. Finish with one terminal Chrona action: ${currentNodeResultActionNames.filter((name) => name !== "chrona_plan_output").join(", ")}. These actions report this Chrona node outcome back to Chrona.`,
    ...catalogSection,
    "Current Node Context JSON:",
    runtimeJson(runtimeInput),
  ].join("\n\n");
  return { instructions, runtimeInput };
}

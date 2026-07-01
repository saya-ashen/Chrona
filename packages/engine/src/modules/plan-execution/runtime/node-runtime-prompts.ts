import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  NodeRuntimeInput,
} from "@chrona/contracts/ai";
import { chronaPlanOutputCatalogPrompt } from "@chrona/ui-protocol";

import { buildNodeRuntimeInput } from "./node-runtime-refs";

export const NODE_RUNTIME_TERMINAL_TOOLS = {
  task: ["chrona_plan_output", "chrona_node_complete", "chrona_node_block", "chrona_node_fail"],
  condition: [
    "chrona_condition_select",
    "chrona_node_block",
    "chrona_node_fail",
  ],
  checkpoint: ["chrona_node_block", "chrona_node_fail"],
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
When you call chrona_node_block you must include a reason and an actionForm that tells the user how to unblock: actionForm.instructions (what the user should do) and actionForm.inputFields (at least one field, each with name and label; set type "text", "textarea", or "select", and options for a select). Without a valid actionForm the block is rejected.
After chrona_node_complete, chrona_condition_select, chrona_wait_complete, chrona_node_block, or chrona_node_fail succeeds, stop immediately. Do not continue downstream nodes.
`.trim();

const PLAN_OUTPUT_CATALOG_PROMPT = chronaPlanOutputCatalogPrompt();

function resultArtifactGuidance(runtimeInput: NodeRuntimeInput): string {
  const outputDir = `.chrona/outputs/${runtimeInput.node.ref}/`;
  return `For generated result artifacts not explicitly requested as repo/code changes, treat the current working directory as the workspace root and write only under ${outputDir}. For long Markdown reports or large evidence, prefer writing a .md/.txt/.json/.csv file there, then reference it from plan output with FileView or FileRef using the same repo-relative path. Keep ResultSummary/Card/Markdown/Table as the readable summary; do not dump long report bodies directly into chrona_plan_output patches. Do not use absolute paths, .. segments, secrets/tokens/credentials/key paths, or backend IDs in file paths.`;
}


function nodeTypeInstructions(node: EffectivePlanNode): string {
  switch (node.type) {
    case "task":
      return `When the current task-node has user-visible deliverables, call chrona_plan_output with RFC 6902 SpecStream patches before completion. Generate UI using only the Chrona plan-output catalog (see CATALOG_UI_SPEC below). chrona_plan_output may be called multiple times to update the shared plan-level output. Call chrona_node_complete only when the current task-node objective is fully satisfied and required output patches have succeeded. If the objective requires filesystem, shell, browser, network, or code execution capability and that capability is unavailable, call chrona_node_block instead of chrona_node_complete. Call chrona_node_fail for unrecoverable errors.

      For user-visible deliverables, pass "patches" as JSON Patch operations. Example bootstrap call: { patches: [{ "op": "add", "path": "/root", "value": "root" }, { "op": "add", "path": "/elements/root", "value": { "type": "Stack", "props": { "direction": "vertical", "gap": "md" }, "children": ["title", "body"] } }, { "op": "add", "path": "/elements/title", "value": { "type": "Heading", "props": { "text": "Result", "level": "h3" }, "children": [] } }, { "op": "add", "path": "/elements/body", "value": { "type": "Markdown", "props": { "content": "details" }, "children": [] } }], summary: "Updated plan output" }

      Final Spec after applying patches must be self-contained and closed: root must reference an existing element id, every child id referenced in any children array must exist as an element id, every element id must be unique, and no element may be omitted as a placeholder unless that element is also declared in elements.

      Spec hard rules, all enforced by validation: (1) root MUST equal one element id. (2) Leaf elements use children: []. (3) children contains child element-id strings only. (4) Every child id MUST exist in elements. (5) No element may include itself or create a cycle. (6) Component type MUST be from CATALOG_UI_SPEC. (7) props MUST match that component schema exactly. (8) visible is an element-level field, not a prop. (9) The plan-output catalog is intentionally small: use Stack/Card/Heading/Text/Markdown/Table/Badge/Alert/FileRef/JsonView/ResultSummary/CollapsibleText/Separator only.`
    case "condition":
      return `Evaluate exactly one listed branch and call chrona_condition_select with branchRef. Do not use labels, nextNodeId, default branches, natural-language conclusions, or incomplete JSON as routing authority. If no explicit branchRef is safe, call chrona_node_block.`;
    case "checkpoint":
      return `Review only the current checkpoint context. Do not submit checkpoint decisions: Checkpoint submission is performed by the user in the frontend. Call chrona_node_block when waiting for user input or approval, and chrona_node_fail only for unrecoverable errors.`;
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
}): { instructions: string; runtimeInput: NodeRuntimeInput } {
  const currentNodeResultActionNames = [
    ...NODE_RUNTIME_TERMINAL_TOOLS[input.node.type],
  ];
  const runtimeInput = buildNodeRuntimeInput({
    plan: input.plan,
    node: input.node,
  });

  const catalogSection = input.node.type === "task"
    ? [resultArtifactGuidance(runtimeInput), PLAN_OUTPUT_CATALOG_PROMPT]
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

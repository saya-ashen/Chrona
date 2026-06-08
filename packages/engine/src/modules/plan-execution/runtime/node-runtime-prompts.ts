import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  NodeRuntimeInput,
} from "@chrona/contracts/ai";
import { buildNodeRuntimeInput } from "./node-runtime-refs";
import { chronaCatalog, CATALOG_VERSION } from "@chrona/ui-protocol";

export const NODE_RUNTIME_TERMINAL_TOOLS = {
  task: ["chrona_node_output", "chrona_node_complete", "chrona_node_block", "chrona_node_fail"],
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

function nodeTypeInstructions(node: EffectivePlanNode): string {
  switch (node.type) {
    case "task":
      return `When the current task-node has user-visible deliverables, call chrona_node_output with those outputs before completion. Submit one json-render Spec using the Chrona workspace catalog (see CATALOG_UI_SPEC below). chrona_node_output may be called multiple times to replace the prior output with mode "replace". Call chrona_node_complete only when the current task-node objective is fully satisfied and required outputs have already been submitted. If the objective requires filesystem, shell, browser, network, or code execution capability and that capability is unavailable, call chrona_node_block instead of chrona_node_complete. Call chrona_node_fail for unrecoverable errors.

For user-visible deliverables, chrona_node_output must use the official json-render Spec directly: { "outputs": [{ "root": "rootElementId", "elements": { "rootElementId": { "type": "ComponentName", "props": {}, "children": [] } }, "state": {} }], "mode": "replace" }.

The spec is the official json-render flat element tree: root is one element id, elements is an object keyed by element id, each element has type plus optional props and children child-id arrays, and state is optional. Use component/action names and props exactly as listed in the catalog prompt. Never submit a json-render Spec as kind "json", kind "ui", or under another wrapper key.`;
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
    ? [
        "CATALOG_UI_SPEC — json-render Spec schema for Chrona task-node deliverables:",
        chronaCatalog.prompt({ mode: "generate" }),
        `catalogVersion: "${CATALOG_VERSION}" — Chrona validates submitted Specs against this catalog version internally; do not include catalogVersion in the Spec.`,
      ]
    : [];

  const instructions = [
    NODE_RUNTIME_PROTOCOL,
    nodeTypeInstructions(input.node),
    `When task-node work produces deliverables, submit them with chrona_node_output first. Finish with one terminal Chrona action: ${currentNodeResultActionNames.filter((name) => name !== "chrona_node_output").join(", ")}. These actions report this Chrona node outcome back to Chrona.`,
    ...catalogSection,
    "Current Node Context JSON:",
    runtimeJson(runtimeInput),
  ].join("\n\n");
  return { instructions, runtimeInput };
}

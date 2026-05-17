import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  NodeRuntimeInput,
} from "@chrona/contracts/ai";
import { buildNodeRuntimeInput } from "./node-runtime-refs";

export const NODE_RUNTIME_TERMINAL_TOOLS = {
  task: ["chrona_task_complete", "chrona_node_block", "chrona_node_fail"],
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
After a Chrona result submission action succeeds, stop immediately. Do not continue downstream nodes.
`.trim();

function nodeTypeInstructions(node: EffectivePlanNode): string {
  switch (node.type) {
    case "task":
      return `Call chrona_task_complete only when the current task-node objective is fully satisfied. If the objective requires filesystem, shell, browser, network, or code execution capability and that capability is unavailable, call chrona_node_block instead of chrona_task_complete. Call chrona_node_fail for unrecoverable errors.`;
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
    currentNodeResultActionNames,
  });
  const instructions = [
    NODE_RUNTIME_PROTOCOL,
    nodeTypeInstructions(input.node),
    `Chrona node result submission actions: ${currentNodeResultActionNames.join(", ")}. These actions only report the final outcome of this Chrona node back to Chrona. They are not execution capabilities, not filesystem access, not shell access, not browser access, not code execution, and not the provider's full capability inventory. Do not infer runtime capabilities from this list.`,
    "Current Node Context JSON:",
    runtimeJson(runtimeInput),
  ].join("\n\n");
  return { instructions, runtimeInput };
}

import type { EffectivePlanGraph, EffectivePlanNode, NodeRuntimeInput } from "@chrona/contracts/ai";
import { buildNodeRuntimeInput } from "./node-runtime-refs";

export const NODE_RUNTIME_TERMINAL_TOOLS = {
  task: ["chrona_task_complete", "chrona_node_block", "chrona_node_fail"],
  condition: ["chrona_condition_select", "chrona_node_block", "chrona_node_fail"],
  checkpoint: ["chrona_node_block", "chrona_node_fail"],
  wait: ["chrona_wait_complete", "chrona_node_block", "chrona_node_fail"],
} as const;

const NODE_RUNTIME_PROTOCOL = `
You are Chrona's node runtime worker.
Chrona backend owns real task, plan, graph, node, and layer IDs. You must never invent or emit backend IDs.
Use only AI-visible refs from runtime input: taskRef, planRef, node.ref, and branchOptions[].ref.
Use provider-native tools for ordinary work such as files, shell, browser, web, or integrations when available.
Use Chrona MCP tools only to read Chrona state and report allowed terminal state transitions.
After a Chrona terminal MCP tool succeeds, stop immediately. Do not continue downstream nodes.
`.trim();

function nodeTypeInstructions(node: EffectivePlanNode): string {
  switch (node.type) {
    case "task":
      return `Call chrona_task_complete only when the current task-node objective is satisfied. Call chrona_node_block for missing external input or unavailable capability. Call chrona_node_fail for unrecoverable errors.`;
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
  const allowedTerminalTools = [...NODE_RUNTIME_TERMINAL_TOOLS[input.node.type]];
  const runtimeInput = buildNodeRuntimeInput({
    plan: input.plan,
    node: input.node,
    allowedTerminalTools,
  });
  const instructions = [
    NODE_RUNTIME_PROTOCOL,
    nodeTypeInstructions(input.node),
    `Allowed Chrona terminal tools: ${allowedTerminalTools.join(", ")}`,
    "Current Node Context JSON:",
    runtimeJson(runtimeInput),
  ].join("\n\n");
  return { instructions, runtimeInput };
}

import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  NodeRuntimeInput,
} from "@chrona/contracts/ai";
import { buildNodeRuntimeInput } from "./node-runtime-refs";

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

const NODE_OUTPUT_CATALOG_PROMPT = `
CATALOG_UI_SPEC — use this catalog only inside chrona_node_output.spec.

Spec shape for chrona_node_output tool arguments: { root: string, elements: Array<{ id: string, type: string, props: object, children: string[], visible?: unknown }>, state?: object }.
Submit the complete Spec as the chrona_node_output tool argument: { spec, mode: "replace", summary }. Chrona converts this array form to the internal flat json-render element record before rendering.
Do not output JSONL, RFC 6902 patches, markdown outside the tool call, or catalogVersion.

Available components:
- Stack props: { direction?: "horizontal" | "vertical", gap?: "none" | "sm" | "md" | "lg" | "xl", align?: "start" | "center" | "end" | "stretch", justify?: "start" | "center" | "end" | "between" | "around", className?: string }.
- Card props: { title?: string, description?: string, maxWidth?: "sm" | "md" | "lg" | "full", centered?: boolean, className?: string }.
- Separator props: { orientation?: "horizontal" | "vertical" }.
- Heading props: { text: string, level?: "h1" | "h2" | "h3" | "h4" }.
- Text props: { text: string, variant?: "default" | "muted" | "lead" | "code" }.
- Badge props: { text: string, variant?: "default" | "secondary" | "destructive" | "outline" }.
- Alert props: { title: string, message?: string, type?: "info" | "success" | "warning" | "error" }.
- Table props: { columns: string[], rows: string[][], caption?: string }. columns and rows must be direct JSON arrays, not wrapper objects.
- Markdown props: { content: string, title?: string }.
- JsonView props: { value: unknown, title?: string }.
- FileRef props: { path: string, title?: string, language?: string, description?: string }.
- ResultSummary props: { text?: string, copyText?: string }. Use once near the top when helpful.
- CollapsibleText props: { text: string, threshold?: number }. threshold must be a JSON number, not a string.
`.trim();

function nodeTypeInstructions(node: EffectivePlanNode): string {
  switch (node.type) {
    case "task":
      return `When the current task-node has user-visible deliverables, call chrona_node_output with a complete json-render Spec before completion. Generate UI using only the Chrona node-output catalog (see CATALOG_UI_SPEC below). chrona_node_output may be called multiple times to replace the prior output with mode "replace". Call chrona_node_complete only when the current task-node objective is fully satisfied and required outputs have already been submitted. If the objective requires filesystem, shell, browser, network, or code execution capability and that capability is unavailable, call chrona_node_block instead of chrona_node_complete. Call chrona_node_fail for unrecoverable errors.

      For user-visible deliverables, pass "spec" as one complete json-render Spec using array-form elements. Do NOT submit patches, JSONL, nested element trees, markdown-only text, legacy output fields, or flat elements records. Tool argument example: { spec: { root: "root", elements: [{ id: "root", type: "Stack", props: { direction: "vertical", gap: "md" }, children: ["title", "body"] }, { id: "title", type: "Heading", props: { text: "Result", level: "h3" }, children: [] }, { id: "body", type: "Markdown", props: { content: "details" }, children: [] }] }, mode: "replace", summary: "Submitted result UI" }

      The submitted spec must be self-contained and closed: every child id referenced in any children array must exist as an element id, root must reference an existing element id, every element id must be unique, and no element may be omitted as a "summary", "meta", or "file" child placeholder unless that element is also declared in elements. Do not rely on later repair passes to add missing elements.

      Spec hard rules, all enforced by validation: (1) root MUST equal one element id. (2) Every element MUST include id, type, props, and children. Leaf elements use children: []. (3) children contains child element-id strings only, never inline objects or values like ["[]"]. (4) Every child id MUST exist in elements. (5) No element may include itself or create a cycle. (6) Component type MUST be from CATALOG_UI_SPEC. (7) props MUST match that component schema exactly. (8) visible is an element-level field, not a prop. (9) The node-output catalog is intentionally small: use Stack/Card/Heading/Text/Markdown/Table/Badge/Alert/FileRef/JsonView/ResultSummary/CollapsibleText/Separator only.`
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
    ? [NODE_OUTPUT_CATALOG_PROMPT]
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

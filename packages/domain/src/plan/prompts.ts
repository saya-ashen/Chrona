import type { EditablePlan, PlanPatch } from "@chrona/contracts/ai";

/**
 * Builds a system prompt for the AI to propose a PlanPatch against an existing plan.
 * The AI should NOT return a full graph — only the patch operations.
 */
export function buildPlanPatchPrompt(
  plan: EditablePlan,
  userInstruction: string,
): string {
  const parts: string[] = [
    "You are editing an existing plan. Propose ONLY a PlanPatch — do NOT return the full plan.",
    "",
    "## Current plan",
    `Plan ID: ${plan.id}`,
    `Version: ${plan.version}`,
    `Title: ${plan.title}`,
    `Goal: ${plan.goal}`,
    "",
    "## Current nodes",
    ...plan.nodes.map((n) => {
      let desc = `  - ${n.id} [${n.type}] ${n.title}`;
      if (n.type === "condition") {
        desc += ` → branches: ${n.branches.map((b) => `${b.label}=${b.nextNodeId}`).join(", ")}`;
      }
      return desc;
    }),
    "",
    "## Current edges",
    ...plan.edges.map(
      (e) => `  ${e.from} → ${e.to}${e.label ? ` [${e.label}]` : ""}`,
    ),
    "",
    "## Patch rules",
    "1. Your patch MUST target basePlanId: '" +
      plan.id +
      "' and baseVersion: " +
      plan.version,
    "2. Available operations: update_plan, add_node, update_node, delete_node, add_edge, delete_edge, replace_subgraph",
    "3. DO NOT modify runtime fields (status, attempts, toolCalls, artifacts, logs).",
    "4. DO NOT change completed node statuses.",
    "5. DO NOT generate tool calls inside patch nodes.",
    "6. Keep existing node IDs stable — do not rename nodes.",
    "7. New node IDs must be snake_case.",
    "8. update_node must NOT change node.type.",
    "9. delete_node automatically removes associated edges.",
    "10. add_edge must preserve DAG property (no cycles).",
    "11. After patch application, the plan will be re-validated.",
    "",
    "## Patch output shape",
    "{",
    '  "basePlanId": "' + plan.id + '",',
    '  "baseVersion": ' + plan.version + ",",
    '  "rationale": "Why this change is needed",',
    '  "operations": [',
    '    { "op": "update_plan", "patch": { "title": "New title" } },',
    '    { "op": "add_node", "node": { ... } },',
    '    { "op": "add_edge", "edge": { "from": "a", "to": "b" } },',
    "  ]",
    "}",
    "",
    "## User's editing instruction",
    userInstruction,
  ];

  return parts.join("\n");
}

/**
 * Proposes a PlanPatch.
 *
 * This is the function that would call the AI provider in production.
 * For now, it returns a placeholder — actual AI integration is handled
 * by the ai-features or providers layer.
 */
export async function proposePlanPatch(
  _currentPlan: EditablePlan,
  _userInstruction: string,
): Promise<PlanPatch> {
  throw new Error(
    "proposePlanPatch: AI integration not yet implemented in domain layer. " +
      "Use the ai-features or providers layer to call an AI model with " +
      "buildPlanPatchPrompt() as the system prompt.",
  );
}

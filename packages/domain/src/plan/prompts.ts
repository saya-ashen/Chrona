import type { EditablePlan, PlanPatch } from "@chrona/contracts/ai";

/**
 * Builds a system prompt for the AI to generate a new EditablePlan from a user task.
 * The AI should return a complete EditablePlan structure.
 */
export function buildPlanGenerationPrompt(task: {
  title: string;
  description?: string;
  estimatedMinutes?: number;
}): string {
  const parts: string[] = [
    "Create a concise plan blueprint as an EditablePlan JSON object.",
    "",
    "## Node types allowed",
    "- **task**: executable work unit. Must have executor (user|ai|system) and mode (manual|assist|auto).",
    "- **checkpoint**: human interaction gate. Must have checkpointType (confirm|choose|input|edit|approve), prompt, required (boolean).",
    "- **condition**: branching logic. Must have condition, evaluationBy (system|ai|user), branches (at least 1).",
    "- **wait**: pause execution. Must have waitFor, optional timeout.",
    "",
    "## Critical rules",
    "1. Do NOT include runtime fields: status, attempts, toolCalls, artifactIds, logs, timestamps.",
    "2. Use ONLY node types: task, checkpoint, condition, wait.",
    "3. NEVER use: start, end, ai_action, tool_action, integration, deliverable, user_input, decision, milestone.",
    "4. Snake_case node IDs (e.g. review_budget, send_confirmation).",
    "5. 3-7 nodes for normal tasks, more for complex ones.",
    "6. Place approve/confirm checkpoint BEFORE high-risk tasks (send, delete, pay, modify, etc.).",
    "7. Express start/end via edges — no start/end nodes.",
    "8. Keep node IDs stable and readable.",
    "9. Output in the same language as the user's task.",
    "10. completionPolicy is NOT part of the output — backend injects it.",
    "",
    "## Output shape",
    '{',
    '  "id": "plan_snake_case_id",',
    '  "version": 1,',
    '  "title": "Brief plan title",',
    '  "goal": "What this plan achieves",',
    '  "assumptions": ["Optional assumptions"],',
    '  "nodes": [',
    '    {',
    '      "id": "snake_case_id",',
    '      "type": "task",',
    '      "title": "Task title",',
    '      "executor": "ai",',
    '      "mode": "auto",',
    '      "expectedOutput": "What success looks like",',
    '      "completionCriteria": "How to verify completion"',
    '    }',
    '  ],',
    '  "edges": [',
    '    { "from": "node_a", "to": "node_b" }',
    '  ]',
    '}',
  ];

  parts.push("", "## Task to plan", `Title: ${task.title}`);
  if (task.description) {
    parts.push(`Description: ${task.description}`);
  }
  if (typeof task.estimatedMinutes === "number") {
    parts.push(`Estimated duration: ${task.estimatedMinutes} minutes`);
  }

  return parts.join("\n");
}

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
    ...plan.edges.map((e) => `  ${e.from} → ${e.to}${e.label ? ` [${e.label}]` : ""}`),
    "",
    "## Patch rules",
    "1. Your patch MUST target basePlanId: '" + plan.id + "' and baseVersion: " + plan.version,
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

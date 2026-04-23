import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("chrona structured result plugin tools", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "index.ts"), "utf8");

  it("registers readable business tools only", () => {
    expect(source).toContain('name: "suggest_task_completions"');
    expect(source).toContain('name: "generate_task_plan_graph"');
    expect(source).not.toContain('name: "submit_structured_result"');
  });

  it("exposes expected schema fields for business tools", () => {
    expect(source).toContain("const SuggestTaskCompletionsSchema");
    expect(source).toContain('required: ["input"]');
    expect(source).toContain("const GenerateTaskPlanGraphSchema");
    expect(source).toContain('required: ["title", "summary", "nodes", "edges"]');
  });

  it("generate_task_plan_graph uses tool input as source of truth and falls back to a minimal DAG", () => {
    expect(source).toContain("buildMinimalPlanGraph");
    expect(source).toContain('inputMode: "graph_in_tool_input"');
    expect(source).toContain("fallbackUsed");
  });
});

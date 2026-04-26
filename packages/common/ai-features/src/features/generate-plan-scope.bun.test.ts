import { describe, expect, it } from "bun:test";

import { buildFeatureInput } from "../core/providers";
import { buildGeneratePlanScope } from "../core/streaming";

describe("generate plan scope", () => {
  it("prefers provided session key for existing task flows", () => {
    expect(
      buildGeneratePlanScope({
        taskId: "task-1",
        title: "Plan task",
        sessionKey: "chrona:openclaw:task:task-1:default",
      }),
    ).toBe("chrona:openclaw:task:task-1:default");
  });

  it("uses adhoc scope instead of default when task id is empty", () => {
    const scope = buildGeneratePlanScope({
      taskId: "",
      title: "周末毁灭全人类",
    });

    expect(scope).toStartWith("adhoc-");
    expect(scope).not.toBe("default");
  });

  it("builds semantic model-facing input without transport identifiers", () => {
    const input = buildFeatureInput("generate_plan", {
      taskId: "task-1",
      title: "写论文答辩 PPT",
      description: "准备硕士论文答辩材料",
      estimatedMinutes: 180,
      sessionKey: "chrona:openclaw:task:task-1:default",
    });

    expect(input).toEqual({
      task: {
        title: "写论文答辩 PPT",
        description: "准备硕士论文答辩材料",
        estimatedDurationMinutes: 180,
      },
    });
    expect(JSON.stringify(input)).not.toContain("task-1");
    expect(JSON.stringify(input)).not.toContain("sessionKey");
  });
});

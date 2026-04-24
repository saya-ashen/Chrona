import { describe, expect, it } from "bun:test";

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
});

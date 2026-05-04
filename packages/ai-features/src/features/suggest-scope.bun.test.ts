import { describe, expect, it } from "bun:test";

import { buildSuggestScope } from "../core/streaming";

describe("suggest scope", () => {
  it("prefers provided session key", () => {
    expect(
      buildSuggestScope({
        input: "买蜜雪冰城",
        kind: "auto-complete",
        sessionKey: "chrona:openclaw:task:task-1:default",
      }),
    ).toBe("chrona:openclaw:task:task-1:default");
  });

  it("does not include raw unicode input in generated adhoc scope", () => {
    const scope = buildSuggestScope({
      input: "买蜜雪冰城",
      kind: "auto-complete",
      workspaceId: "default",
    });

    expect(scope).toMatch(/^default-auto-complete-[a-z0-9_-]+-[a-f0-9]{8}-[a-z0-9]{8}$/);
    expect(scope).not.toContain("买蜜雪冰城");
  });
});

import { describe, expect, test } from "bun:test";

import { renderPrompt } from "./runner-helpers";

describe("renderPrompt", () => {
  test("includes provider input payload after instructions", () => {
    const prompt = renderPrompt({
      clientOperationId: "claude-code-render-prompt-object",
      sessionId: "session-1",
      instructions: "Generate an outline.",
      input: {
        resourceId: "resource-1",
        title: "查询并总结今天的github trendings",
        description: null,
      },
      timeoutMs: 120_000,
      stream: true,
    });

    expect(prompt).toContain("Generate an outline.");
    expect(prompt).toContain("## Provider input");
    expect(prompt).toContain('"resourceId": "resource-1"');
    expect(prompt).toContain('"title": "查询并总结今天的github trendings"');
    expect(prompt).toContain('"description": null');
  });

  test("renders canonical text input without JSON wrapping", () => {
    const prompt = renderPrompt({
      clientOperationId: "claude-code-render-prompt-text",
      sessionId: "session-1",
      instructions: "Generate an outline.",
      input: {
        type: "text",
        text: "Create a concise plan.\nTitle: 查询并总结今天的github trendings",
      },
      stream: true,
    });

    expect(prompt).toContain("Generate an outline.");
    expect(prompt).toContain("## Provider input");
    expect(prompt).toContain("Title: 查询并总结今天的github trendings");
    expect(prompt).not.toContain('"type": "text"');
  });
});

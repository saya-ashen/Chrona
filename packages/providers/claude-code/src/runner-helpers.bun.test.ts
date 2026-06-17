import { describe, expect, test } from "bun:test";

import { renderPrompt } from "./runner-helpers";

describe("renderPrompt", () => {
  test("includes provider input payload after instructions", () => {
    const prompt = renderPrompt({
      sessionId: "session-1",
      instructions: "Generate a Chrona plan.",
      input: {
        taskId: "task-1",
        title: "查询并总结今天的github trendings",
        description: null,
      },
      timeoutMs: 120_000,
      stream: true,
    });

    expect(prompt).toContain("Generate a Chrona plan.");
    expect(prompt).toContain("## Chrona provider input");
    expect(prompt).toContain('"taskId": "task-1"');
    expect(prompt).toContain('"title": "查询并总结今天的github trendings"');
    expect(prompt).toContain('"description": null');
  });

  test("renders canonical text input without JSON wrapping", () => {
    const prompt = renderPrompt({
      sessionId: "session-1",
      instructions: "Generate a Chrona plan.",
      input: {
        type: "text",
        text: "Create a concise plan.\nTitle: 查询并总结今天的github trendings",
      },
      stream: true,
    });

    expect(prompt).toContain("Generate a Chrona plan.");
    expect(prompt).toContain("## Chrona provider input");
    expect(prompt).toContain("Title: 查询并总结今天的github trendings");
    expect(prompt).not.toContain('"type": "text"');
  });
});

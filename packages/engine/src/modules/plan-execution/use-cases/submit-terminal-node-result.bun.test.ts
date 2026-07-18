import { describe, expect, it } from "bun:test";
import { malformedPlanOutputMarkdownPath } from "./submit-terminal-node-result";

function richMarkdown(content: string) {
  return {
    root: "body",
    elements: {
      body: {
        type: "RichMarkdown",
        props: { content },
        children: [],
      },
    },
  };
}

describe("plan output Markdown validation", () => {
  it("rejects pre-escaped Markdown block line breaks", () => {
    expect(
      malformedPlanOutputMarkdownPath(
        richMarkdown("**Findings**\\n\\n- First\\n- Second"),
      ),
    ).toBe("/elements/body/props/content");
  });

  it("accepts actual Markdown line breaks", () => {
    expect(
      malformedPlanOutputMarkdownPath(
        richMarkdown("**Findings**\n\n- First\n- Second"),
      ),
    ).toBeNull();
  });

  it("accepts legitimate literal newline notation", () => {
    expect(
      malformedPlanOutputMarkdownPath(
        richMarkdown("JavaScript uses `\\n`; JSON may contain `\\n` too."),
      ),
    ).toBeNull();
  });
});

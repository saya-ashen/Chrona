import { describe, expect, test } from "bun:test";
import { validateChronaSpec, type ValidateResult } from "./validate";
import type { UiDocument } from "./document";

function expectIssue(result: ValidateResult, fragment: string) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(
    result.issues.some((issue) => `${issue.path} ${issue.message}`.includes(fragment)),
  ).toBe(true);
}

describe("validateChronaSpec", () => {
  test("accepts a well-formed spec mixing shadcn + custom components", () => {
    const spec: UiDocument = {
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: "md" }, children: ["title", "md"] },
        title: { type: "Text", props: { text: "Result", variant: "muted" }, children: [] },
        md: { type: "Markdown", props: { content: "# hello" }, children: [] },
      },
    };
    expect(validateChronaSpec(spec).ok).toBe(true);
  });

  test("normalizes lowercase report components and repairs missing root", () => {
    const spec = {
      root: "github_trending_report",
      elements: {
        heading: { type: "heading", props: { text: "GitHub Trending" } },
        summary_text: { type: "paragraph", props: { text: "Daily report" } },
        table: { type: "table", props: { columns: ["Repo"], rows: [["chrona"]] } },
        trend_analysis: { type: "section", props: {}, children: ["raw_data_path"] },
        raw_data_path: { type: "paragraph", props: { text: "data.json" } },
      },
    };

    const result = validateChronaSpec(spec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.root).toBe("github_trending_report");
    expect(result.spec.elements.github_trending_report).toMatchObject({ type: "Stack" });
  });


  test("allows omitting optional/nullable props", () => {
    const spec: UiDocument = {
      root: "t",
      elements: { t: { type: "Text", props: { text: "hi" }, children: [] } },
    };
    expect(validateChronaSpec(spec).ok).toBe(true);
  });

  test("rejects a non-spec structure", () => {
    expectIssue(validateChronaSpec({ foo: 1 }), "not a spec");
  });

  test("rejects an unknown component", () => {
    const spec = { root: "r", elements: { r: { type: "ScriptTag", props: {}, children: [] } } };
    expectIssue(validateChronaSpec(spec), "unknown component");
  });

  test("rejects a present prop with the wrong type", () => {
    const spec = {
      root: "r",
      elements: { r: { type: "Text", props: { text: 42 }, children: [] } },
    };
    expectIssue(validateChronaSpec(spec), "elements.r.props.text");
  });

  test("rejects a dangling child reference", () => {
    const spec = {
      root: "r",
      elements: { r: { type: "Stack", props: {}, children: ["nope"] } },
    };
    expectIssue(validateChronaSpec(spec), "");
  });

  test("validates a form built from shadcn primitives", () => {
    const spec: UiDocument = {
      root: "form",
      elements: {
        form: { type: "Stack", props: { gap: "sm" }, children: ["field", "submit"] },
        field: {
          type: "Select",
          props: { name: "decision", label: "Decision", options: ["Approve", "Reject"] },
          children: [],
        },
        submit: { type: "Button", props: { label: "Send" }, children: [] },
      },
    };
    expect(validateChronaSpec(spec).ok).toBe(true);
  });
});

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

  test("accepts dynamic expressions on typed string props (repeat + $item)", () => {
    // The catalog prompt teaches the AI to use repeat + $item for lists. This
    // is the exact shape that was wrongly rejected as "expected string,
    // received object" before expression-aware stripping.
    const spec: UiDocument = {
      root: "list",
      elements: {
        list: {
          type: "Stack",
          props: { direction: "vertical", gap: "sm" },
          repeat: { statePath: "/repos", key: "fullName" },
          children: ["title"],
        },
        title: { type: "Link", props: { label: { $item: "fullName" }, href: { $item: "url" } }, children: [] },
      },
      state: { repos: [{ fullName: "a/b", url: "https://example.com" }] },
    };
    expect(validateChronaSpec(spec).ok).toBe(true);
  });

  test("accepts $state, $template, and $cond expressions where literals are typed", () => {
    for (const text of [
      { $state: "/title" },
      { $template: "Hi ${/name}" },
      { $cond: { $state: "/flag" }, $then: "yes", $else: "no" },
    ]) {
      const spec = {
        root: "h",
        elements: { h: { type: "Heading", props: { text, level: "h2" }, children: [] } },
        state: { title: "x", name: "y", flag: true },
      };
      expect(validateChronaSpec(spec).ok).toBe(true);
    }
  });

  test("accepts a dynamic expression on a typed enum prop", () => {
    const spec = {
      root: "h",
      elements: { h: { type: "Heading", props: { text: "x", level: { $state: "/level" } }, children: [] } },
      state: { level: "h2" },
    };
    expect(validateChronaSpec(spec).ok).toBe(true);
  });

  test("still rejects a genuine invalid enum value (gap outside the documented set)", () => {
    const spec = {
      root: "s",
      elements: { s: { type: "Stack", props: { gap: "xs" }, children: [] } },
    };
    expectIssue(validateChronaSpec(spec), "elements.s.props.gap");
  });

  test("rejects a literal type error even when a sibling prop is a dynamic expression", () => {
    const spec = {
      root: "s",
      elements: { s: { type: "Stack", props: { gap: "xs", direction: { $state: "/d" } }, children: [] } },
      state: { d: "vertical" },
    };
    const result = validateChronaSpec(spec);
    expectIssue(result, "elements.s.props.gap");
    if (result.ok) return;
    // The dynamic sibling must NOT produce a spurious issue.
    expect(result.issues.some((i) => i.path.includes("direction"))).toBe(false);
  });
});

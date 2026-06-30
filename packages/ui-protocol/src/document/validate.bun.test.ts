import { describe, expect, test } from "bun:test";
import { chronaCatalog, chronaPlanOutputCatalogPrompt, validateChronaSpec, validateDashboardSummarySpec, type ValidateResult } from "../index";
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

  test("catalog prompt gives literal Table and CollapsibleText examples", () => {
    const prompt = chronaCatalog.prompt();

    expect(prompt).toContain("Table:");
    expect(prompt).toContain("columns: [\"Repo\", \"Stars\"]");
    expect(prompt).toContain("rows: [[\"chrona\", \"120\"]]");
    expect(prompt).toContain("Do not wrap arrays in objects such as { item: [...] }");
    expect(prompt).toContain("threshold MUST be a JSON number such as 800");
  });

  test("plan-output prompt discourages raw JsonView reports", () => {
    const prompt = chronaPlanOutputCatalogPrompt();

    expect(prompt).toContain("Card containers");
    expect(prompt).toContain("Use JsonView sparingly");
    expect(prompt).toContain("remove elements no longer reachable from root");
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

  test("rejects missing child, cycle, invalid table, activity, and action payload structures", () => {
    expectIssue(validateChronaSpec({
      root: "root",
      elements: { root: { type: "Stack", props: {}, children: ["missing-child"] } },
    }), "missing-child");

    expectIssue(validateChronaSpec({
      root: "root",
      elements: {
        root: { type: "Stack", props: {}, children: ["child"] },
        child: { type: "Stack", props: {}, children: ["root"] },
      },
    }), "cycle");

    expectIssue(validateChronaSpec({
      root: "table",
      elements: { table: { type: "Table", props: { columns: ["Repo"], rows: [{ item: ["chrona"] }] }, children: [] } },
    }), "elements.table.props.rows");

    expectIssue(validateChronaSpec({
      root: "activity",
      elements: { activity: { type: "ActivityStream", props: { items: [{ id: "event-1", title: 42, summary: "Ran", tone: "info" }] }, children: [] } },
    }), "elements.activity.props.items");

    expectIssue(validateChronaSpec({
      root: "button",
      elements: { button: { type: "Button", props: { label: "Run" }, on: { press: { action: "dispatch-execution", params: { actionId: "" } } }, children: [] } },
    }), "elements.button.on.press.params.actionId");
  });

describe("validateDashboardSummarySpec", () => {
  test("accepts only compact dashboard summary components", () => {
    const result = validateDashboardSummarySpec({
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: "md" }, children: ["title", "summary", "risk"] },
        title: { type: "Heading", props: { text: "AI summary", level: "h3" }, children: [] },
        summary: { type: "Text", props: { text: "Two tasks completed; one needs review." }, children: [] },
        risk: { type: "Alert", props: { title: "Needs review", description: "Approval blocks next run." }, children: [] },
      },
    });

    expect(result.ok).toBe(true);
  });

  test("rejects interactive or broad workspace components", () => {
    expectIssue(validateDashboardSummarySpec({
      root: "button",
      elements: { button: { type: "Button", props: { label: "Approve" }, children: [] } },
    }), "Invalid discriminator value");

    expectIssue(validateDashboardSummarySpec({
      root: "activity",
      elements: { activity: { type: "ActivityStream", props: { items: [] }, children: [] } },
    }), "Invalid discriminator value");
  });

  test("rejects dynamic expressions and unknown props", () => {
    expectIssue(validateDashboardSummarySpec({
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: "md" }, children: ["title"] },
        title: { type: "Heading", props: { text: { $state: "/title" }, level: "h3" }, children: [] },
      },
      state: { title: "Injected" },
    }), "Invalid input");

    expectIssue(validateDashboardSummarySpec({
      root: "root",
      elements: {
        root: { type: "Stack", props: { gap: "md" }, repeat: { statePath: "/items" }, children: [] },
      },
    }), "Unrecognized key");
  });
});
});

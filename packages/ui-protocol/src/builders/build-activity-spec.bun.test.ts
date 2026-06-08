import { describe, expect, test } from "bun:test";
import { buildActivitySpec, type ActivityItemInput, type ToolDetailLabels } from "./build-activity-spec";
import { validateChronaSpec } from "../document/validate";

const labels: ToolDetailLabels = {
  tool: "Tool",
  input: "Input",
  preview: "Preview",
  duration: "Duration",
  error: "Error",
};

describe("buildActivitySpec", () => {
  test("produces a catalog-valid spec for a mix of items", () => {
    const items: ActivityItemInput[] = [
      {
        id: "a",
        kind: "assistant_message",
        title: "Planned the work",
        summary: "Drafted three steps",
        tone: "info",
        timestamp: "2026-06-05T09:30:00.000Z",
        sourceNodeTitle: "Plan",
      },
      {
        id: "b",
        kind: "tool_completed",
        title: "Ran search",
        tone: "success",
        timestamp: "2026-06-05T09:31:00.000Z",
        tool: { name: "search", inputSummary: "query=foo", durationMs: 142.6, state: "completed" },
        assistant: { text: "found 4 results" },
      },
    ];

    const spec = buildActivitySpec(items, labels);
    const result = validateChronaSpec(spec);
    expect(result.ok).toBe(true);
  });

  test("maps fields and derives the HH:MM time label", () => {
    const spec = buildActivitySpec(
      [{ id: "a", kind: "node", title: "Step", tone: "warning", timestamp: "2026-06-05T14:05:33Z" }],
      labels,
    );
    const row = spec.elements["row:a"];
    expect(row.type).toBe("ActivityRow");
    expect(row.props).toMatchObject({ title: "Step", tone: "warning", time: "14:05", kind: "node" });
    expect(row.children).toEqual([]);
    expect(spec.elements.root.children).toEqual(["row:a"]);
  });

  test("attaches a ToolDetails child only when the tool has detail rows", () => {
    const withTool = buildActivitySpec(
      [{ id: "t", kind: "tool_completed", title: "x", tool: { name: "fs", error: "boom", state: "failed" } }],
      labels,
    );
    expect(withTool.elements["row:t"].children).toEqual(["tool:t"]);
    expect(withTool.elements["tool:t"].props).toEqual({
      rows: [
        { label: "Tool", value: "fs" },
        { label: "Error", value: "boom" },
      ],
    });

    const noRows = buildActivitySpec(
      [{ id: "t", kind: "tool_started", title: "x", tool: { state: "started" } }],
      labels,
    );
    expect(noRows.elements["row:t"].children).toEqual([]);
    expect(noRows.elements["tool:t"]).toBeUndefined();
  });

  test("omits tool details in compact density", () => {
    const spec = buildActivitySpec(
      [{ id: "tool", kind: "tool_completed", title: "Tool", summary: "Done", tool: { state: "completed", label: "Read", inputSummary: "taskId=task-1" } }],
      labels,
      { density: "compact" },
    );

    expect(Object.values(spec.elements).some((element) => element.type === "ToolDetails")).toBe(false);
    expect(spec.elements["row:tool"]?.children).toEqual([]);
  });

  test("prefers assistant text over summary for the row text", () => {
    const spec = buildActivitySpec(
      [{ id: "a", kind: "assistant_message", title: "x", summary: "s", assistant: { text: "a-text" } }],
      labels,
    );
    expect(spec.elements["row:a"].props).toMatchObject({ text: "a-text" });
  });
});

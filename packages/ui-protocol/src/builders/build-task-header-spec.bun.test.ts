import { describe, expect, it } from "bun:test";
import { buildTaskHeaderSpec } from "./build-task-header-spec";

describe("buildTaskHeaderSpec", () => {
  it("materializes header metadata nodes in returned spec", () => {
    const spec = buildTaskHeaderSpec({
      title: "Launch task",
      status: "running",
      statusLabel: "Running",
      progressLabel: "3 steps · 2 accepted · 67%",
      priorityLabel: "High",
      workspaceStateLabel: "Workspace",
      workspaceStateGuidance: "Execution paused for review.",
      occurrenceLabel: "Occurrence · May 27",
      sourceLabel: "External calendar",
      actions: [{ id: "edit", label: "Edit" }, { id: "delete", label: "Delete Task" }],
    });

    expect(spec.elements.summary).toMatchObject({
      type: "Text",
      props: { text: "3 steps · 2 accepted · 67%" },
    });
    expect(spec.elements.guidance).toMatchObject({
      type: "Text",
      props: { text: "Execution paused for review." },
    });
    expect(spec.elements["meta-row"]).toMatchObject({
      children: expect.arrayContaining(["summary", "guidance"]),
    });
    expect(spec.elements["title-row"]).toMatchObject({
      children: expect.arrayContaining(["badge:workspace-state", "badge:primary-state", "badge:priority"]),
    });
  });
});

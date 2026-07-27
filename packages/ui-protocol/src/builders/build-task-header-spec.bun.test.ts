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
    expect(spec.elements.guidance).toBeUndefined();
    expect(spec.elements.root).toMatchObject({
      type: "Stack",
      props: { className: expect.not.stringContaining("rounded") },
    });
    const detailChildren = JSON.stringify(spec.elements["detail-row"]?.children);
    expect(detailChildren).not.toContain("guidance");
    expect(spec.elements["title-row"]).toMatchObject({
      children: ["title"],
    });
    expect(detailChildren).toContain("badge:workspace-state");
    expect(detailChildren).toContain("badge:primary-state");
    expect(detailChildren).toContain("badge:priority");
  });

  it("places plan generation stop action in header actions", () => {
    const spec = buildTaskHeaderSpec({
      title: "Launch task",
      status: "waiting",
      statusLabel: "Ready",
      progressLabel: "No plan",
      actions: [{ id: "generate-plan", label: "Generate plan" }],
    });

    expect(spec.elements.actions?.children).toContain("action:stop-plan-generation");
    expect(spec.elements["action:stop-plan-generation"]).toMatchObject({
      type: "Button",
      props: {
        label: "Stop generation",
        variant: "danger",
        disabled: { $state: "/plan/generation/stop-disabled" },
      },
      visible: { $state: "/plan/generation/is-running" },
      on: { press: { action: "stop-plan-generation", params: {} } },
    });
    expect(spec.elements["action:generate-plan"]?.props).toMatchObject({
      label: "Generate plan",
      disabled: { $state: "/plan/generation/header-action-disabled" },
    });
  });
  it("places run-from-beginning in the overflow menu", () => {
    const spec = buildTaskHeaderSpec({
      title: "Launch task",
      status: "running",
      statusLabel: "Running",
      progressLabel: "1 of 3",
      actions: [
        { id: "restart", label: "Run plan from beginning" },
        { id: "edit", label: "Edit" },
        { id: "delete", label: "Delete Task" },
      ],
    });

    expect(spec.elements["header-overflow"]?.props).toMatchObject({
      items: [
        { label: "Run plan from beginning", value: "restart" },
        { label: "Edit", value: "edit" },
        { label: "Delete Task", value: "delete" },
      ],
    });
  });
});

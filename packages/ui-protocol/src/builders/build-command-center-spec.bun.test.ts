import { describe, expect, it } from "bun:test";
import { buildCommandCenterCheckpointSpec, buildCommandCenterTrailSpec } from "./build-command-center-spec";

describe("buildCommandCenterTrailSpec", () => {
  it("binds activity stream props to json-render state", () => {
    const spec = buildCommandCenterTrailSpec({
      activity: [{
        id: "activity-1",
        kind: "tool_started",
        title: "Tool started",
        summary: "Read plan",
        tool: { label: "Read", state: "started" },
      }],
      liveCount: 0,
      savedCount: 1,
      toolLabels: { tool: "Tool", input: "Input", preview: "Preview", duration: "Duration", error: "Error" },
    });

    expect(spec.state).toMatchObject({
      trail: {
        items: [expect.objectContaining({ id: "activity-1" })],
        liveCount: 0,
        savedCount: 1,
        provider: null,
      },
    });
    expect(spec.elements.activity).toMatchObject({
      type: "ActivityStream",
      props: {
        items: { $bindState: "/trail/items" },
        liveCount: { $bindState: "/trail/liveCount" },
        savedCount: { $bindState: "/trail/savedCount" },
        provider: { $bindState: "/trail/provider" },
      },
    });
    expect(spec.elements.root).toMatchObject({
      type: "Stack",
      props: { gap: "sm" },
      children: ["title", "provider", "activity"],
    });
  });
});

describe("buildCommandCenterCheckpointSpec", () => {
  it("renders failed execution recovery as one compact recovery group", () => {
    const spec = buildCommandCenterCheckpointSpec({
      checkpoint: {
        id: "plan-1:node-1:failed",
        nodeId: "node-1",
        title: "Failed: Fetch GitHub Trending",
        message: "q is not defined",
        severity: "error",
        availableActions: [
          { id: "retry_node", label: "Retry node", style: "primary", requiresPayload: false },
          { id: "request_replan", label: "Request replan", style: "secondary", requiresPayload: true },
          { id: "fail_task", label: "Fail task", style: "danger", requiresPayload: true },
          { id: "cancel_session", label: "Cancel execution", style: "danger", requiresPayload: false },
        ],
      },
    });

    expect(spec.elements.root.children).toEqual(["status", "recovery-actions"]);
    expect(spec.elements["recovery-actions"]).toMatchObject({
      type: "WorkspaceActionGroup",
      props: { label: "Recovery actions", layout: "inline" },
      children: ["action:retry_node"],
    });
    expect(spec.elements["field:request_replan"]).toBeUndefined();
    expect(spec.elements["submit:request_replan"]).toBeUndefined();
    expect(spec.elements["action:request_replan"]).toBeUndefined();
    expect(spec.elements["action:fail_task"]).toBeUndefined();
    expect(spec.elements["action:cancel_session"]).toBeUndefined();
    expect(spec.elements["form-actions"]).toBeUndefined();
  });
});

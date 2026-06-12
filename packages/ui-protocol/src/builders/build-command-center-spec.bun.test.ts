import { describe, expect, it } from "bun:test";
import { buildCommandCenterTrailSpec } from "./build-command-center-spec";

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

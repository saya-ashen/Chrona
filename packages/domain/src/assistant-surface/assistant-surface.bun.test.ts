import { describe, expect, it } from "bun:test";
import {
  assistantActionRequiresPreview,
  createAssistantProposalRoute,
  isAssistantActionRunnable,
  isAssistantPreviewSurface,
  normalizeAssistantAction,
  pickTopAssistantSummary,
  sortAssistantSummaries,
} from "./index";

describe("assistant surface domain helpers", () => {
  it("orders summaries by severity", () => {
    const summaries = sortAssistantSummaries([
      { id: "ok", label: "Queue", value: "0", severity: "success" },
      { id: "block", label: "Blocker", value: "Waiting", severity: "critical" },
      { id: "warn", label: "Review", value: "Needed", severity: "warning" },
    ]);

    expect(summaries.map((item) => item.id)).toEqual(["block", "warn", "ok"]);
    expect(pickTopAssistantSummary(summaries).id).toBe("block");
  });

  it("maps preview-required actions to owning surfaces", () => {
    const action = normalizeAssistantAction({
      id: "retry-node",
      label: "Retry node",
      description: "Preview retrying the active node.",
      kind: "informational",
      enabled: true,
    });

    expect(action.kind).toBe("proposal");
    expect(action.previewRequired).toBe(true);
    expect(action.previewSurface).toBe("task.graph");
    expect(assistantActionRequiresPreview("find-opening")).toBe(false);
  });

  it("detects disabled actions", () => {
    const action = normalizeAssistantAction({
      id: "modify-plan",
      label: "Modify plan",
      description: "Preview plan edits.",
      kind: "proposal",
      enabled: false,
      disabledReason: "No plan yet.",
    });

    expect(isAssistantActionRunnable(action)).toBe(false);
  });

  it("validates proposal routes", () => {
    const route = createAssistantProposalRoute({
      id: "p1",
      surface: "schedule.timeline",
      label: "Smart schedule",
      baseHref: "/schedule?view=timeline",
      createdAt: "2026-05-19T00:00:00.000Z",
    });

    expect(route.href).toContain("assistantProposal=p1");
    expect(isAssistantPreviewSurface(route.surface)).toBe(true);
    expect(isAssistantPreviewSurface("dropdown.confirm")).toBe(false);
  });
});

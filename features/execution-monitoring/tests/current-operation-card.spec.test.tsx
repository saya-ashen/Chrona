/**
 * Spec 019 — "Current operation" card has 4 distinct variants, one per
 * `TaskWorkspacePlanFlowState`. This test asserts the per-state card
 * content produced by `resolveCurrentOperationCardSpec` and that the
 * `buildCommandCenterNowSpec` wrapper feeds the resolved spec into the
 * `WorkspaceSummaryCard`.
 *
 * Pure spec test — no React render needed.
 *
 * Plan: specs/019-plan-card-and-accept-tests/plan.md §3 (test A).
 */
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";

import { buildCommandCenterNowSpec } from "../ui/build-execution-overview-spec";
import { resolveCurrentOperationCardSpec } from "../ui/build-execution-overview-spec";
import { executionMonitoringPlanFixtures } from "./execution-monitoring-test-fixtures";
import type { TaskWorkspacePlanFlowState } from "../../task-workspace";

/**
 * Build a minimal `TaskWorkspacePlanFlowState` literal for a given status.
 * Keeps the four `case` arms above the helper readable.
 */
function flowFor(status: TaskWorkspacePlanFlowState["status"]): TaskWorkspacePlanFlowState {
  switch (status) {
    case "idle":
      return { status: "idle", savedPlan: null };
    case "generating":
      return { status: "generating", savedPlan: null };
    case "waiting_acceptance":
      return { status: "waiting_acceptance", savedPlan: null };
    case "accepting":
      return { status: "accepting", planId: "plan-1", savedPlan: null };
    case "accepted":
      return { status: "accepted", savedPlan: null };
    case "failed":
      return { status: "failed", planId: "plan-1", savedPlan: null, error: "boom" };
  }
}

describe("resolveCurrentOperationCardSpec — 4 plan-state variants", () => {
  it("idle: sparkles, info, 'No plan yet'", () => {
    const card = resolveCurrentOperationCardSpec({
      planFlow: flowFor("idle"),
      planSummary: null,
    });
    expect(card).toEqual({
      title: "No plan yet",
      description: "Generate a plan to start this task.",
      statusLabel: "Idle",
      tone: "info",
      icon: "sparkles",
    });
  });

  it("generating: sparkles, info, 'Generating plan…'", () => {
    const card = resolveCurrentOperationCardSpec({
      planFlow: flowFor("generating"),
      planSummary: "Tell Chrona what to change in the regenerated plan...",
    });
    expect(card).toEqual({
      title: "Generating plan…",
      // When a user instruction is present, surface it as the description
      // (truncated to 120 chars).
      description: "Tell Chrona what to change in the regenerated plan...",
      statusLabel: "Generating",
      tone: "info",
      icon: "sparkles",
    });
  });

  it("generating with no instruction: falls back to the default copy", () => {
    const card = resolveCurrentOperationCardSpec({
      planFlow: flowFor("generating"),
      planSummary: null,
    });
    expect(card?.description).toBe("Chrona is drafting a plan for this task.");
  });

  it("waiting_acceptance: sparkles, info, 'Plan ready for review'", () => {
    const card = resolveCurrentOperationCardSpec({
      planFlow: flowFor("waiting_acceptance"),
      planSummary: "Research X, draft Y, deliver Z.",
    });
    expect(card).toEqual({
      title: "Plan ready for review",
      description: "Research X, draft Y, deliver Z.",
      statusLabel: "Waiting for acceptance",
      tone: "info",
      icon: "sparkles",
    });
  });

  it("waiting_acceptance truncates summaries longer than 120 chars with '…'", () => {
    const long = "a".repeat(150);
    const card = resolveCurrentOperationCardSpec({
      planFlow: flowFor("waiting_acceptance"),
      planSummary: long,
    });
    expect(card?.description).toBe(`${"a".repeat(120)}…`);
  });

  it("accepted: check, success, 'Plan accepted'", () => {
    const card = resolveCurrentOperationCardSpec({
      planFlow: flowFor("accepted"),
      planSummary: "irrelevant — accepted card ignores planSummary",
    });
    expect(card).toEqual({
      title: "Plan accepted",
      description: "Execution will start when the block is due.",
      statusLabel: "Accepted",
      tone: "success",
      icon: "check",
    });
  });

  it("accepting: shows the same card as waiting_acceptance with status 'Accepting'", () => {
    const card = resolveCurrentOperationCardSpec({
      planFlow: flowFor("accepting"),
      planSummary: "Research X, draft Y, deliver Z.",
    });
    expect(card).toEqual({
      title: "Plan ready for review",
      description: "Research X, draft Y, deliver Z.",
      statusLabel: "Accepting",
      tone: "info",
      icon: "sparkles",
    });
  });

  it("failed: surfaces the error message in the description", () => {
    const card = resolveCurrentOperationCardSpec({
      planFlow: flowFor("failed"),
      planSummary: null,
    });
    expect(card?.title).toBe("Couldn't accept the plan");
    expect(card?.description).toBe("boom");
    expect(card?.statusLabel).toBe("Accept failed");
  });

  it("null planFlow returns null (wrapper falls back to attention/readiness)", () => {
    const card = resolveCurrentOperationCardSpec({ planFlow: null, planSummary: null });
    expect(card).toBeNull();
  });
});

describe("buildCommandCenterNowSpec — plan-state variants land in WorkspaceSummaryCard", () => {
  const dummyReadiness = {
    id: "readiness",
    title: "Fallback readiness",
    description: "fallback",
    tone: "info" as const,
  };
  const dummyAttention = null;
  const dummyCopy = { currentOperation: "Current operation" };

  function statusCardOf(spec: ReturnType<typeof buildCommandCenterNowSpec>): {
    eyebrow: string | undefined;
    title: string;
    description: string | undefined;
    statusLabel: string | undefined;
    tone: string | undefined;
    icon: string | undefined;
  } {
    const card = spec.elements["status-card"];
    if (!card || card.type !== "WorkspaceSummaryCard") {
      throw new Error("status-card element missing or wrong type");
    }
    const props = card.props as Record<string, unknown>;
    return {
      eyebrow: typeof props.eyebrow === "string" ? props.eyebrow : undefined,
      title: String(props.title),
      description: typeof props.description === "string" ? props.description : undefined,
      statusLabel: typeof props.statusLabel === "string" ? props.statusLabel : undefined,
      tone: typeof props.tone === "string" ? props.tone : undefined,
      icon: typeof props.icon === "string" ? props.icon : undefined,
    };
  }

  it("planIdle: 'No plan yet' with sparkles + info", () => {
    const flow: TaskWorkspacePlanFlowState = { status: "idle", savedPlan: null };
    const spec = buildCommandCenterNowSpec({
      readiness: dummyReadiness,
      attention: dummyAttention,
      runtimeEvents: [],
      copy: dummyCopy,
      planFlow: flow,
      planSummary: null,
    });
    const card = statusCardOf(spec);
    expect(card.eyebrow).toBe("Current operation");
    expect(card.title).toBe("No plan yet");
    expect(card.statusLabel).toBe("Idle");
    expect(card.tone).toBe("info");
    expect(card.icon).toBe("sparkles");
  });

  it("planGenerating: 'Generating plan…' with sparkles + info", () => {
    const flow: TaskWorkspacePlanFlowState = { status: "generating", savedPlan: null };
    const spec = buildCommandCenterNowSpec({
      readiness: dummyReadiness,
      attention: dummyAttention,
      runtimeEvents: [],
      copy: dummyCopy,
      planFlow: flow,
      planSummary: null,
    });
    const card = statusCardOf(spec);
    expect(card.title).toBe("Generating plan…");
    expect(card.statusLabel).toBe("Generating");
    expect(card.tone).toBe("info");
    expect(card.icon).toBe("sparkles");
  });

  it("planWaitingAcceptance: 'Plan ready for review' with sparkles + info + summary", () => {
    const { waitingAcceptance } = executionMonitoringPlanFixtures;
    const summary = waitingAcceptance.pageData.task.savedPlan?.summary ?? null;
    const flow = waitingAcceptance.flow;
    const spec = buildCommandCenterNowSpec({
      readiness: dummyReadiness,
      attention: dummyAttention,
      runtimeEvents: [],
      copy: dummyCopy,
      planFlow: flow,
      planSummary: summary,
    });
    const card = statusCardOf(spec);
    expect(card.title).toBe("Plan ready for review");
    expect(card.statusLabel).toBe("Waiting for acceptance");
    expect(card.tone).toBe("info");
    expect(card.icon).toBe("sparkles");
    expect(card.description).toBe(summary);
  });

  it("planAccepted: 'Plan accepted' with check + success", () => {
    const flow: TaskWorkspacePlanFlowState = { status: "accepted", savedPlan: null };
    const spec = buildCommandCenterNowSpec({
      readiness: dummyReadiness,
      attention: dummyAttention,
      runtimeEvents: [],
      copy: dummyCopy,
      planFlow: flow,
      planSummary: null,
    });
    const card = statusCardOf(spec);
    expect(card.title).toBe("Plan accepted");
    expect(card.statusLabel).toBe("Accepted");
    expect(card.tone).toBe("success");
    expect(card.icon).toBe("check");
  });
});

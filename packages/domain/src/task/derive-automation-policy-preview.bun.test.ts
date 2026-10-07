import { describe, expect, test } from "bun:test";
import { deriveAutomationPolicyPreview } from "./derive-automation-policy-preview";

const scheduledStartAt = "2026-07-15T09:00:00.000Z";

const cases = [
  {
    name: "keeps manual work manual",
    input: { autoPlanGeneration: false, autoExecute: false },
    expected: {
      mode: "manual_plan_manual_execute",
      willGeneratePlan: false,
      requiresPlanAcceptance: false,
      willAutoExecute: false,
      readiness: "ready",
    },
  },
  {
    name: "generates a plan but waits for acceptance",
    input: {
      autoPlanGeneration: true,
      autoExecute: false,
      providerId: "ai-1",
      providerName: "Hermes",
    },
    expected: {
      mode: "auto_plan_manual_approval",
      willGeneratePlan: true,
      requiresPlanAcceptance: true,
      willAutoExecute: false,
      readiness: "ready",
    },
  },
  {
    name: "prepares one scheduled occurrence for automatic execution",
    input: {
      taskId: "task-1",
      workBlockId: "block-1",
      scheduledStartAt,
      autoPlanGeneration: true,
      autoExecute: true,
      providerId: "ai-1",
      providerName: "Hermes",
      hasAcceptedPlan: true,
    },
    expected: {
      mode: "accepted_plan_scheduled_execute",
      willGeneratePlan: true,
      requiresPlanAcceptance: false,
      willAutoExecute: true,
      readiness: "ready",
      occurrenceKey: "task-1:block-1",
    },
  },
] as const;

describe("deriveAutomationPolicyPreview", () => {
  test.each([
    ["immediate", "immediate", null],
    ["at_start", "scheduled", scheduledStartAt],
    ["before_30m", "scheduled", "2026-07-15T08:30:00.000Z"],
    ["before_1d", "scheduled", "2026-07-14T09:00:00.000Z"],
  ] as const)("shows the actual %s execution trigger", (timing, trigger, at) => {
    expect(deriveAutomationPolicyPreview({
      autoExecute: true, autoPlanGeneration: true, scheduledStartAt,
      autoExecuteTiming: timing, providerId: "ai-1",
    })).toMatchObject({ executionTrigger: trigger, nextOccurrenceAt: at });
  });

  test("immediate execution needs no schedule; invalid dates do not crash preview", () => {
    expect(deriveAutomationPolicyPreview({ autoExecute: true, autoPlanGeneration: true,
      autoExecuteTiming: "immediate", providerId: "ai-1", hasAcceptedPlan: true,
    }).readiness).toBe("ready");
    expect(deriveAutomationPolicyPreview({ autoExecute: true, autoPlanGeneration: true,
      scheduledStartAt: "invalid", providerId: "ai-1",
    }).readiness).toBe("schedule_time_missing");
  });
  for (const entry of cases) {
    test(entry.name, () => {
      expect(deriveAutomationPolicyPreview(entry.input)).toMatchObject(entry.expected);
    });
  }

  test("explains missing AI configuration", () => {
    expect(
      deriveAutomationPolicyPreview({
        scheduledStartAt,
        autoPlanGeneration: true,
        autoExecute: true,
      }),
    ).toMatchObject({
      readiness: "provider_not_configured",
      disabledReason: "Connect an AI before enabling automation.",
    });
  });

  test("distinguishes connection test and capability failures", () => {
    expect(
      deriveAutomationPolicyPreview({
        scheduledStartAt,
        autoPlanGeneration: true,
        autoExecute: false,
        providerId: "ai-1",
        providerTested: false,
      }).readiness,
    ).toBe("provider_test_required");
    expect(
      deriveAutomationPolicyPreview({
        scheduledStartAt,
        autoPlanGeneration: true,
        autoExecute: true,
        providerId: "ai-1",
        providerTested: true,
        providerReachable: true,
        planningCapable: true,
        executionCapable: false,
      }).readiness,
    ).toBe("execution_capability_missing");
  });

  test("documents restart, missed-run, retry, and pause behavior", () => {
    const preview = deriveAutomationPolicyPreview({
      scheduledStartAt,
      autoPlanGeneration: true,
      autoExecute: true,
      providerId: "ai-1",
    });
    expect(preview.processRequirement).toContain("Closing this page does not stop");
    expect(preview.missedRunPolicy).toContain("next scheduler scan");
    expect(preview.retryPolicy).toContain("does not automatically retry");
    expect(preview.pauseConditions).toHaveLength(2);
  });
});

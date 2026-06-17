import { describe, expect, it } from "bun:test";

import { deriveAutoStartEligibility, type TaskLike } from "@/modules/scheduling/derive-auto-start-eligibility";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const MINUTE = 60_000;

function task(overrides: Partial<TaskLike> = {}): TaskLike {
  return {
    status: "Ready",
    executionRuntime: "hermes",
    hasAcceptedPlan: true,
    ...overrides,
  };
}

function startAt(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}


describe("deriveAutoStartEligibility reasons", () => {
  it("reports not_scheduled without a work block", () => {
    expect(deriveAutoStartEligibility({ task: task(), workBlock: null, now: NOW })).toEqual({
      ok: false,
      reason: "not_scheduled",
    });
  });

  it("reports already_running for active execution states", () => {
    for (const status of ["Pending", "Running", "WaitingForInput", "WaitingForApproval"]) {
      expect(
        deriveAutoStartEligibility({
          task: task(),
          workBlock: { scheduledStartAt: startAt(-MINUTE) },
          now: NOW,
          activeRun: { status },
        }),
      ).toEqual({ ok: false, reason: "already_running" });
    }
  });

  it("reports invalid_task_status before runtime and plan checks", () => {
    expect(
      deriveAutoStartEligibility({
        task: task({ status: "Blocked", executionRuntime: null, hasAcceptedPlan: false }),
        workBlock: { scheduledStartAt: startAt(-MINUTE) },
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "invalid_task_status" });
  });

  it("reports no_runtime_config before accepted plan checks", () => {
    expect(
      deriveAutoStartEligibility({
        task: task({ executionRuntime: null, hasAcceptedPlan: false }),
        workBlock: { scheduledStartAt: startAt(-MINUTE) },
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "no_runtime_config" });
  });

  it("reports no_accepted_plan when runtime is configured", () => {
    expect(
      deriveAutoStartEligibility({
        task: task({ hasAcceptedPlan: false }),
        workBlock: { scheduledStartAt: startAt(-MINUTE) },
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "no_accepted_plan" });
  });
});
describe("deriveAutoStartEligibility timing offsets", () => {
  it("at_start: not_due while start is in the future", () => {
    const result = deriveAutoStartEligibility({
      task: task({ autoExecuteTiming: "at_start" }),
      workBlock: { scheduledStartAt: startAt(5 * MINUTE) },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "not_due" });
  });

  it("at_start: eligible once start has passed", () => {
    const result = deriveAutoStartEligibility({
      task: task({ autoExecuteTiming: "at_start" }),
      workBlock: { scheduledStartAt: startAt(-MINUTE) },
      now: NOW,
    });
    expect(result).toEqual({ ok: true, mode: "start_task" });
  });

  it("before_1h: not_due when start is more than 1h away", () => {
    const result = deriveAutoStartEligibility({
      task: task({ autoExecuteTiming: "before_1h" }),
      workBlock: { scheduledStartAt: startAt(90 * MINUTE) },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "not_due" });
  });

  it("before_1h: eligible once within 1h of start (fires early)", () => {
    const result = deriveAutoStartEligibility({
      task: task({ autoExecuteTiming: "before_1h" }),
      workBlock: { scheduledStartAt: startAt(30 * MINUTE) },
      now: NOW,
    });
    expect(result).toEqual({ ok: true, mode: "start_task" });
  });

  it("immediate: eligible even when start is far in the future", () => {
    const result = deriveAutoStartEligibility({
      task: task({ autoExecuteTiming: "immediate" }),
      workBlock: { scheduledStartAt: startAt(-MINUTE) },
      now: NOW,
    });
    expect(result).toEqual({ ok: true, mode: "start_task" });
  });

  it("defaults to at_start when timing is missing", () => {
    const result = deriveAutoStartEligibility({
      task: task({ autoExecuteTiming: null }),
      workBlock: { scheduledStartAt: startAt(5 * MINUTE) },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "not_due" });
  });
});

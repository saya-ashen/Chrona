import { describe, expect, it } from "bun:test";
import {
  deriveAutoStartEligibility,
  type TaskLike,
  type RunLike,
  type WorkBlockLike,
} from "@/modules/tasks/derive-auto-start-eligibility";

function makeTask(overrides: Partial<TaskLike> = {}): TaskLike {
  return {
    status: "Ready",
    runtimeAdapterKey: "openclaw",
    ...overrides,
  };
}

function makeWorkBlock(overrides: Partial<WorkBlockLike> = {}): WorkBlockLike {
  return {
    scheduledStartAt: new Date(Date.now() - 30_000),
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunLike> = {}): RunLike {
  return {
    status: "Running",
    ...overrides,
  };
}

const now = new Date();

describe("deriveAutoStartEligibility", () => {
  describe("eligible", () => {
    it("returns ok when task is scheduled, due, has correct status and no active run", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask(),
        workBlock: makeWorkBlock(),
        now,
        activeRun: null,
      });
      expect(result).toEqual({ ok: true, mode: "start_task" });
    });

    it("returns ok when a due work block exists and task is otherwise eligible", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask(),
        workBlock: makeWorkBlock(),
        now,
        activeRun: null,
      });
      expect(result).toEqual({ ok: true, mode: "start_task" });
    });

    it("returns ok when task status is Ready", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask({ status: "Ready" }),
        workBlock: makeWorkBlock(),
        now,
        activeRun: null,
      });
      expect(result.ok).toBe(true);
    });

    it("returns ok when task status is Scheduled", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask({ status: "Scheduled" }),
        workBlock: makeWorkBlock(),
        now,
        activeRun: null,
      });
      expect(result.ok).toBe(true);
    });

    it("returns ok when task status is Queued", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask({ status: "Queued" }),
        workBlock: makeWorkBlock(),
        now,
        activeRun: null,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("not eligible — not_scheduled", () => {
    it("rejects tasks with no scheduled work block", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask(),
        workBlock: null,
        now,
        activeRun: null,
      });
      expect(result).toEqual({ ok: false, reason: "not_scheduled" });
    });

    it("rejects tasks with a work block that has no start time", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask(),
        workBlock: makeWorkBlock({ scheduledStartAt: null }),
        now,
        activeRun: null,
      });
      expect(result).toEqual({ ok: false, reason: "not_due" });
    });
  });

  describe("not eligible — not_due", () => {
    it("rejects tasks with no scheduledStartAt", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask(),
        workBlock: makeWorkBlock({ scheduledStartAt: null }),
        now,
        activeRun: null,
      });
      expect(result).toEqual({ ok: false, reason: "not_due" });
    });

    it("rejects tasks with future scheduledStartAt", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask(),
        workBlock: makeWorkBlock({ scheduledStartAt: new Date(Date.now() + 60_000) }),
        now,
        activeRun: null,
      });
      expect(result).toEqual({ ok: false, reason: "not_due" });
    });
  });

  describe("not eligible — already_running", () => {
    it("rejects tasks with an active Pending run", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask(),
        workBlock: makeWorkBlock(),
        now,
        activeRun: makeRun({ status: "Pending" }),
      });
      expect(result).toEqual({ ok: false, reason: "already_running" });
    });

    it("rejects tasks with an active Running run", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask(),
        workBlock: makeWorkBlock(),
        now,
        activeRun: makeRun({ status: "Running" }),
      });
      expect(result).toEqual({ ok: false, reason: "already_running" });
    });

    it("rejects tasks with an active WaitingForInput run", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask(),
        workBlock: makeWorkBlock(),
        now,
        activeRun: makeRun({ status: "WaitingForInput" }),
      });
      expect(result).toEqual({ ok: false, reason: "already_running" });
    });

    it("rejects tasks with an active WaitingForApproval run", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask(),
        workBlock: makeWorkBlock(),
        now,
        activeRun: makeRun({ status: "WaitingForApproval" }),
      });
      expect(result).toEqual({ ok: false, reason: "already_running" });
    });
  });

  describe("not eligible — invalid_task_status", () => {
    it("rejects tasks with Draft status", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask({ status: "Draft" }),
        workBlock: makeWorkBlock(),
        now,
        activeRun: null,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_task_status" });
    });

    it("rejects tasks with Done status", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask({ status: "Done" }),
        workBlock: makeWorkBlock(),
        now,
        activeRun: null,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_task_status" });
    });

    it("rejects tasks with Blocked status", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask({ status: "Blocked" }),
        workBlock: makeWorkBlock(),
        now,
        activeRun: null,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_task_status" });
    });
  });

  describe("not eligible — no_runtime_config", () => {
    it("rejects tasks without a runtimeAdapterKey", () => {
      const result = deriveAutoStartEligibility({
        task: makeTask({ runtimeAdapterKey: null }),
        workBlock: makeWorkBlock(),
        now,
        activeRun: null,
      });
      expect(result).toEqual({ ok: false, reason: "no_runtime_config" });
    });
  });
});

import { describe, expect, it } from "bun:test";
import {
  requireTaskId,
  requireWorkspaceId,
} from "@chrona/engine/test-support";

// agent-tools input-guards — pure validation primitives used by
// the agent-tool dispatch pipeline. These are the lowest-level
// guards in the chrona tool surface; failures bubble up as
// validation_error events in the audit trail. The dispatch layer's
// end-to-end behavior is covered by mcp-routes.bun.test.ts; this
// file pins the engine contract on the bare input guards.
//
//   - requireTaskId throws "taskId is required" on falsy/empty
//   - requireTaskId returns the input.taskId when present
//   - requireWorkspaceId throws "workspaceId is required" on falsy
//   - requireWorkspaceId returns the input.workspaceId when present
//   - they accept non-empty string ids exactly (no normalization)
//
// The guards operate on a structural subset of ChronaToolOperation
// ["input"], so we type the test inputs as a minimal local shape.

interface GuardInput {
  taskId?: string;
  workspaceId?: string;
}

describe("agent-tools input-guards (engine)", () => {
  describe("requireTaskId", () => {
    it("returns the taskId when it is a non-empty string", () => {
      const input: GuardInput = { taskId: "task-abc", workspaceId: "ws-1" };
      expect(requireTaskId(input as Parameters<typeof requireTaskId>[0])).toBe("task-abc");
    });

    it("throws when taskId is undefined", () => {
      const input: GuardInput = { workspaceId: "ws-1" };
      expect(() =>
        requireTaskId(input as Parameters<typeof requireTaskId>[0]),
      ).toThrow(/taskId is required/);
    });

    it("throws when taskId is an empty string", () => {
      const input: GuardInput = { taskId: "" };
      expect(() =>
        requireTaskId(input as Parameters<typeof requireTaskId>[0]),
      ).toThrow(/taskId is required/);
    });

    it("preserves the original value (no trim, no coercion)", () => {
      // Guards are intentionally non-normalizing so callers can decide
      // how to handle whitespace; the function just signals presence.
      const input: GuardInput = { taskId: "  task-1  " };
      expect(requireTaskId(input as Parameters<typeof requireTaskId>[0])).toBe("  task-1  ");
    });
  });

  describe("requireWorkspaceId", () => {
    it("returns the workspaceId when it is a non-empty string", () => {
      const input: GuardInput = { workspaceId: "ws-abc" };
      expect(requireWorkspaceId(input as Parameters<typeof requireWorkspaceId>[0])).toBe("ws-abc");
    });

    it("throws when workspaceId is undefined", () => {
      const input: GuardInput = { taskId: "task-1" };
      expect(() =>
        requireWorkspaceId(input as Parameters<typeof requireWorkspaceId>[0]),
      ).toThrow(/workspaceId is required/);
    });

    it("throws when workspaceId is an empty string", () => {
      const input: GuardInput = { workspaceId: "" };
      expect(() =>
        requireWorkspaceId(input as Parameters<typeof requireWorkspaceId>[0]),
      ).toThrow(/workspaceId is required/);
    });

    it("does not require taskId to be present (workspace-only operations allowed)", () => {
      // requireWorkspaceId is independent of taskId — a tool may need
      // a workspace context without a specific task.
      const input: GuardInput = { workspaceId: "ws-1" };
      expect(requireWorkspaceId(input as Parameters<typeof requireWorkspaceId>[0])).toBe("ws-1");
    });
  });

  describe("composability", () => {
    it("both guards can be called sequentially without interfering", () => {
      const input: GuardInput = { taskId: "task-1", workspaceId: "ws-1" };
      const taskId = requireTaskId(input as Parameters<typeof requireTaskId>[0]);
      const workspaceId = requireWorkspaceId(input as Parameters<typeof requireWorkspaceId>[0]);
      expect(taskId).toBe("task-1");
      expect(workspaceId).toBe("ws-1");
    });

    it("throwing on either guard short-circuits the pipeline at the dispatch boundary", () => {
      let reached = false;
      try {
        requireTaskId({ workspaceId: "ws-1" } as Parameters<typeof requireTaskId>[0]);
        requireWorkspaceId({ workspaceId: "ws-1" } as Parameters<typeof requireWorkspaceId>[0]);
        reached = true;
      } catch (cause) {
        expect(cause).toBeInstanceOf(Error);
        expect((cause as Error).message).toBe("taskId is required");
      }
      expect(reached).toBe(false);
    });
  });
});

import { describe, expect, it } from "bun:test";
import {
  manualTaskLifecycleBodySchema,
  scheduleBodySchema,
  taskResultFollowUpBodySchema,
} from "./execution.schema";
import { workCommandBodySchema } from "./projections.schema";

const baseRequest = {
  requestId: "00000000-0000-4000-8000-000000000000",
  intent: "create_task" as const,
  instruction: "Prepare the next task",
};

describe("workCommandBodySchema", () => {
  it.each([
    { action: "resume_with_approval", decision: "approve" },
    { action: "retry_node", nodeId: "node_1" },
    { action: "resume_after_unblock" },
  ] as const)("preserves work-block scope for $action", (action) => {
    expect(
      workCommandBodySchema.parse({
        type: "execution.action",
        idempotencyKey: `command-${action.action}`,
        workBlockId: "block_1",
        ...action,
      }).workBlockId,
    ).toBe("block_1");
  });
});

describe("manual task lifecycle and one-off schedule schemas", () => {
  it("rejects caller-selected manual workspace fields", () => {
    expect(manualTaskLifecycleBodySchema.safeParse({
      expectedRevision: "config-v1:3",
      requestId: "00000000-0000-4000-8000-000000000000",
      workspaceId: "injected-workspace",
    }).success).toBe(false);
  });

  it("allows an unscheduled deadline but rejects an empty schedule mutation", () => {
    expect(scheduleBodySchema.parse({ dueAt: "2030-01-02T10:00:00.000Z" })).toMatchObject({
      dueAt: "2030-01-02T10:00:00.000Z",
    });
    expect(scheduleBodySchema.safeParse({}).success).toBe(false);
  });
});

describe("taskResultFollowUpBodySchema", () => {
  it("defaults child tasks to compact handoff into a new session", () => {
    expect(taskResultFollowUpBodySchema.parse(baseRequest)).toMatchObject({
      sessionStrategy: "handoff_compact",
    });
  });

  it("accepts result-only context and rejects the removed source-session fork", () => {
    expect(
      taskResultFollowUpBodySchema.parse({
        ...baseRequest,
        sessionStrategy: "fresh_with_result",
      }),
    ).toMatchObject({ sessionStrategy: "fresh_with_result" });
    expect(
      taskResultFollowUpBodySchema.safeParse({
        ...baseRequest,
        sessionStrategy: "fork_source_session",
      }).success,
    ).toBe(false);
  });
});

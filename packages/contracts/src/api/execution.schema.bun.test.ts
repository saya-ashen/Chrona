import { describe, expect, it } from "bun:test";
import { taskResultFollowUpBodySchema } from "./execution.schema";

const baseRequest = {
  requestId: "00000000-0000-4000-8000-000000000000",
  intent: "create_task" as const,
  instruction: "Prepare the next task",
};

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

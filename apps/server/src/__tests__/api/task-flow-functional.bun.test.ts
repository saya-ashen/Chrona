import { describe, expect, it } from "bun:test";
import { assertTaskFlowFixtureIsConsistent, createBaselineTaskFlowFixture } from "./task-flow-test-fixtures";

describe("task flow functional scenario fixtures", () => {
  it("defines a deterministic task-to-plan-to-execution path", () => {
    const fixture = createBaselineTaskFlowFixture();

    assertTaskFlowFixtureIsConsistent(fixture);

    expect(fixture.executionPath).toEqual([
      "clean",
      "task-created",
      "plan-generated",
      "execution-started",
      "progress-observed",
      "completed",
    ]);
    expect(fixture.expectedPlanState).toMatchObject({ status: "accepted", nodeCount: 3, checkpointCount: 1 });
  });
});

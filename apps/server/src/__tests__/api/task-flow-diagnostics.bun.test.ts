import { describe, expect, it } from "bun:test";
import { createBaselineTaskFlowFixture, createTaskFlowFailureEvidence } from "./task-flow-test-fixtures";

describe("task flow diagnostic evidence", () => {
  it("captures scenario name, expected outcome, actual outcome, and state snapshot", () => {
    const fixture = createBaselineTaskFlowFixture({
      scenarioId: "diagnostic-terminal-failure",
      terminalOutcome: "failed",
      executionPath: ["clean", "task-created", "plan-generated", "execution-started", "progress-observed", "failed"],
    });
    const evidence = createTaskFlowFailureEvidence({
      scenarioId: fixture.scenarioId,
      expected: "completed task flow",
      actual: fixture.terminalOutcome,
      visibleText: "Execution failed while running deterministic scenario",
      stateSnapshot: {
        taskTitle: fixture.taskInput.title,
        plan: fixture.expectedPlanState,
        executionPath: fixture.executionPath,
      },
    });

    expect(evidence).toMatchObject({
      scenarioId: "diagnostic-terminal-failure",
      expected: "completed task flow",
      actual: "failed",
    });
    expect(evidence.stateSnapshot.executionPath).toEqual(fixture.executionPath);
  });
});

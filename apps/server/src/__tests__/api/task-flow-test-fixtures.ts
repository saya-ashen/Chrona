export type TaskFlowScenarioId =
  | "core-task-flow"
  | "diagnostic-terminal-failure"
  | "checkpoint-supported-flow";

export type TaskFlowState = "clean" | "task-created" | "plan-generated" | "execution-started" | "progress-observed" | "completed" | "failed" | "blocked" | "cancelled";

export type TaskFlowFixture = {
  scenarioId: TaskFlowScenarioId;
  name: string;
  workspaceState: "clean" | "seeded";
  taskInput: {
    title: string;
    description: string;
    priority: "Low" | "Medium" | "High" | "Urgent";
  };
  expectedPlanState: {
    status: "draft" | "accepted";
    nodeCount: number;
    checkpointCount: number;
  };
  executionPath: TaskFlowState[];
  terminalOutcome: Extract<TaskFlowState, "completed" | "failed" | "blocked" | "cancelled">;
};

export type TaskFlowFailureEvidence = {
  scenarioId: string;
  expected: string;
  actual: string;
  stateSnapshot: Record<string, unknown>;
  visibleText?: string;
};

export function createBaselineTaskFlowFixture(overrides: Partial<TaskFlowFixture> = {}): TaskFlowFixture {
  return {
    scenarioId: "core-task-flow",
    name: "Create task, generate plan, execute, and observe terminal state",
    workspaceState: "clean",
    taskInput: {
      title: "Validate Chrona task flow",
      description: "Seeded deterministic functional task flow scenario.",
      priority: "High",
    },
    expectedPlanState: {
      status: "accepted",
      nodeCount: 3,
      checkpointCount: 1,
    },
    executionPath: ["clean", "task-created", "plan-generated", "execution-started", "progress-observed", "completed"],
    terminalOutcome: "completed",
    ...overrides,
  };
}

export function createTaskFlowFailureEvidence(input: TaskFlowFailureEvidence): TaskFlowFailureEvidence {
  return input;
}

export function assertTaskFlowFixtureIsConsistent(fixture: TaskFlowFixture) {
  const finalState = fixture.executionPath.at(-1);

  if (finalState !== fixture.terminalOutcome) {
    throw new Error(`${fixture.scenarioId}: terminal outcome ${fixture.terminalOutcome} did not match path ending ${finalState}`);
  }

  if (fixture.expectedPlanState.nodeCount < fixture.expectedPlanState.checkpointCount) {
    throw new Error(`${fixture.scenarioId}: checkpoint count exceeds node count`);
  }
}

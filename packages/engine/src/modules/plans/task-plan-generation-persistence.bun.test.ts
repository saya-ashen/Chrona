import { describe, expect, it } from "bun:test";

import type { PlanBlueprint } from "@chrona/contracts";
import { AiFeatureRuntimeError } from "@/modules/ai";

import {
  commitTaskPlanGeneration,
  taskPlanActivationSnapshot,
  type PersistedTaskPlanGenerationCandidate,
} from "./task-plan-generation-persistence";
import {
  taskPlanGenerateFeature,
  taskPlanGenerateInputSchema,
} from "./ai/task.plan.generate";

function invalidCandidate(): PersistedTaskPlanGenerationCandidate {
  const blueprint: PlanBlueprint = {
    title: "Invalid generated plan",
    goal: "Exercise the generation commit boundary",
    nodes: [{ id: "only_task", type: "task", title: "Only task", executor: "ai", mode: "auto" }],
    edges: [{ from: "only_task", to: "missing_task" }],
  };

  return {
    runId: "invalid-plan-run",
    expectedRunStateVersion: 1,
    leaseOwner: "feature-runner:test",
    finishedAt: "2026-01-01T00:00:00.000Z",
    terminalResult: {
      status: "completed",
      output: { blueprint },
      artifacts: [],
      proposedActions: [],
      evidence: [],
    },
    completion: {
      valid: true,
      validator: { id: "test", version: 1 },
      issues: [],
    },
    proposedActions: [],
    snapshot: {
      task: {
        id: "task-invalid",
        workspaceId: "workspace-invalid",
        title: "Invalid plan task",
        description: null,
        goalContext: null,
        workBlockId: null,
        estimatedMinutes: null,
      },
      workBlockId: null,
      head: {
        stateVersion: 0,
        currentPlanId: null,
        currentPlanRevision: null,
        currentPlanStatus: null,
        currentPlanContentHash: null,
        baselinePlanId: null,
        baselinePlanRevision: null,
        baselinePlanStatus: null,
        baselinePlanContentHash: null,
        baselineHash: null,
      },
    },
    userInstruction: null,
    selectedNodeId: null,
    blueprint,
  };
}

describe("task plan generation activation context", () => {
  it("freezes scheduler, explicit/manual, and unscheduled activation context without changing legacy inputs", () => {
    const scheduled = taskPlanActivationSnapshot({
      task: { kind: "recurring", recurrenceRule: "FREQ=DAILY" },
      workBlock: {
        trigger: "scheduled",
        scheduledStartAt: new Date("2026-04-01T13:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-01T13:30:00.000Z"),
      },
    });
    const explicit = taskPlanActivationSnapshot({
      task: { kind: "single", recurrenceRule: null },
      workBlock: {
        trigger: "manual",
        scheduledStartAt: new Date("2026-04-01T13:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-01T13:30:00.000Z"),
      },
    });
    const unscheduled = taskPlanActivationSnapshot({
      task: { kind: "single", recurrenceRule: null },
      workBlock: null,
    });

    expect(scheduled).toMatchObject({
      executionScope: "one_authorized_execution",
      activationOwner: "scheduler",
      schedule: { state: "scheduled", taskKind: "recurring", recurrenceRule: "FREQ=DAILY" },
    });
    expect(explicit).toMatchObject({
      executionScope: "one_authorized_execution",
      activationOwner: "explicit_start",
      schedule: { state: "scheduled", taskKind: "single" },
    });
    expect(unscheduled).toEqual({
      executionScope: "one_authorized_execution",
      activationOwner: "explicit_start",
      schedule: {
        state: "unscheduled",
        taskKind: "single",
        recurrenceRule: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
      },
    });

    const legacyInput = taskPlanGenerateInputSchema.parse({
      task: {
        id: "task-1",
        title: "Legacy input",
        description: null,
        goalContext: null,
        workBlockId: null,
        estimatedMinutes: null,
      },
      currentHead: {
        stateVersion: 0,
        currentPlanId: null,
        currentPlanRevision: null,
        currentPlanStatus: null,
        currentPlanContentHash: null,
        baselinePlanId: null,
        baselinePlanRevision: null,
        baselinePlanStatus: null,
        baselinePlanContentHash: null,
        baselineHash: null,
      },
      userInstruction: null,
      selectedNodeId: null,
    });
    const instructions = taskPlanGenerateFeature.buildInstructions({
      workspaceId: "workspace-1",
      subject: { type: "task", id: "task-1", revision: "0" },
      input: legacyInput,
      objective: taskPlanGenerateFeature.buildObjective(legacyInput),
      observations: [],
    });

    const scheduledInput = taskPlanGenerateInputSchema.parse({
      ...legacyInput,
      task: { ...legacyInput.task, activation: scheduled },
    });

    expect(legacyInput.task.activation).toBeUndefined();
    expect(scheduledInput.task.activation).toEqual(scheduled);
    expect(instructions).toContain("exactly one authorized execution occurrence");
    expect(instructions).toContain("does not implement timed in-plan waits or automatic event resumption");
  });
});

describe("commitTaskPlanGeneration", () => {
  it("classifies a compiler-invalid candidate as invalid output before persistence", async () => {
    let error: unknown;
    try {
      await commitTaskPlanGeneration({ candidate: invalidCandidate() });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(AiFeatureRuntimeError);
    expect((error as AiFeatureRuntimeError).detail).toEqual({
      code: "completion_invalid",
      message: "Generated plan did not satisfy required graph rules.",
    });
  });
});

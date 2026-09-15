import { describe, expect, it } from "bun:test";

import type { PlanBlueprint } from "@chrona/contracts";
import { AiFeatureRuntimeError } from "@/modules/ai";

import {
  commitTaskPlanGeneration,
  type PersistedTaskPlanGenerationCandidate,
} from "./task-plan-generation-persistence";

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

import {
  AiFeatureDefinitionRegistry,
  resumeAiFeatureRun,
  runAiFeatureWithRuntime,
  startAiFeatureWithRuntime,
} from "@/modules/ai";
import type { Prisma } from "@/generated/prisma/client";
import { taskPlanGenerateFeature, type TaskPlanGenerateInput } from "./task.plan.generate";
import type { TaskPlanGenerationSnapshot } from "../task-plan-generation-persistence";

export type TaskPlanGenerationFeatureInput = {
  generationId: string;
  snapshot: TaskPlanGenerationSnapshot;
  userInstruction: string | null;
  selectedNodeId: string | null;
};

function featureInput(input: TaskPlanGenerationFeatureInput) {
  return {
    task: {
      id: input.snapshot.task.id,
      title: input.snapshot.task.title,
      description: input.snapshot.task.description,
      goalContext: input.snapshot.task.goalContext,
      workBlockId: input.snapshot.workBlockId,
      estimatedMinutes: input.snapshot.task.estimatedMinutes,
      executionRuntime: input.snapshot.task.executionRuntime,
    },
    currentHead: input.snapshot.head,
    userInstruction: input.userInstruction,
    selectedNodeId: input.selectedNodeId,
  } satisfies TaskPlanGenerateInput;
}

function featureRequest(input: TaskPlanGenerationFeatureInput) {
  return {
    workspaceId: input.snapshot.task.workspaceId,
    definition: taskPlanGenerateFeature,
    subject: {
      type: "task",
      id: input.snapshot.task.id,
      revision: String(input.snapshot.head.stateVersion),
    },
    operation: { kind: "generate", operationId: input.generationId },
    input: featureInput(input),
  };
}

/** Persists a canonical queued feature run and frozen observations before provider execution. */
export async function startTaskPlanGenerateFeature(
  input: TaskPlanGenerationFeatureInput,
  client?: Prisma.TransactionClient,
) {
  return startAiFeatureWithRuntime(featureRequest(input), client);
}

/** Starts and executes immediately for callers that do not require an SSE handoff. */
export async function runTaskPlanGenerateFeature(
  input: TaskPlanGenerationFeatureInput,
  signal?: AbortSignal,
) {
  return runAiFeatureWithRuntime(featureRequest(input), { signal });
}

/** Resumes an already-persisted task plan generation without rebuilding observations. */
export async function resumeTaskPlanGenerateFeature(
  runId: string,
  signal?: AbortSignal,
) {
  return resumeAiFeatureRun({
    runId,
    definitions: new AiFeatureDefinitionRegistry([taskPlanGenerateFeature]),
    signal,
  });
}

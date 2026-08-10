import type {
  GeneratePlanSSEEvent,
  TaskPlanGenerationSessionReadModel,
  TaskPlanReadModel,
} from "@chrona/contracts";
import {
  ENGINE_ERROR_CODES,
  EngineError,
  engineErrorFromUnknown,
} from "../errors";
import { taskPlanning } from "../modules/plans";
import { TaskPlanGenerationInFlightError } from "../modules/plans/task-plan-generation-registry";

export type TaskPlanService = {
  getState(input: { taskId: string; workBlockId?: string | null }): Promise<{
    taskId: string;
    aiPlanGenerationStatus:
      | "accepted"
      | "generating"
      | "idle"
      | "waiting_acceptance";
    savedPlan: TaskPlanReadModel | null;
    generationSession: TaskPlanGenerationSessionReadModel | null;
  }>;
  getActiveGeneration(input: { taskId: string; workBlockId?: string | null }): Promise<{
    generationSession: TaskPlanGenerationSessionReadModel | null;
  }>;
  subscribeToActiveGeneration(input: {
    taskId: string;
    workBlockId?: string | null;
    onEvent: (event: GeneratePlanSSEEvent) => void;
  }): ReturnType<typeof taskPlanning.subscribeToActiveGeneration>;
  accept(input: {
    taskId: string;
    planId: string;
    workBlockId?: string | null;
    workspaceId?: string;
    expectedHeadStateVersion: number;
    idempotencyKey: string;
  }): Promise<{ savedPlan: TaskPlanReadModel | null }>;
  generate(input: {
    taskId: string;
    workBlockId?: string | null;
    forceRefresh?: boolean;
    userInstruction?: string | null;
    selectedNodeId?: string | null;
    idempotencyKey: string;
  }): Promise<{
    generationId: string;
    events: AsyncGenerator<GeneratePlanSSEEvent>;
    emit: (event: GeneratePlanSSEEvent) => void;
    finish: () => void;
  }>;
  // Generated plans are persisted solely by commitTaskPlanGeneration.
  stopGeneration(input: { taskId: string; workBlockId?: string | null }): Promise<{
    taskId: string;
    stopped: boolean;
  }>;
  patch(
    input: Parameters<typeof taskPlanning.patch>[0],
  ): ReturnType<typeof taskPlanning.patch>;
  mutate(
    input: Parameters<typeof taskPlanning.mutate>[0],
  ): ReturnType<typeof taskPlanning.mutate>;
};

export function createTaskPlanService(): TaskPlanService {
  return {
    async getState(input: { taskId: string; workBlockId?: string | null }) {
      try {
        return await taskPlanning.getState(input);
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.TASK_NOT_FOUND,
          "Failed to get task plan state",
        );
      }
    },
    async getActiveGeneration(input: { taskId: string; workBlockId?: string | null }) {
      return taskPlanning.getActiveGeneration(input);
    },
    subscribeToActiveGeneration(input: {
      taskId: string;
      workBlockId?: string | null;
      onEvent: (event: GeneratePlanSSEEvent) => void;
    }) {
      return taskPlanning.subscribeToActiveGeneration(input);
    },
    async accept(input: {
      taskId: string;
      planId: string;
      workBlockId?: string | null;
      workspaceId?: string;
      expectedHeadStateVersion: number;
      idempotencyKey: string;
    }) {
      try {
        return await taskPlanning.accept(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.PLAN_NOT_FOUND, "Failed to accept task AI plan");
      }
    },
    async generate(input: {
      taskId: string;
      workBlockId?: string | null;
      forceRefresh?: boolean;
      userInstruction?: string | null;
      selectedNodeId?: string | null;
      idempotencyKey: string;
    }) {
      try {
        return await taskPlanning.generate(input);
      } catch (cause) {
        if (cause instanceof TaskPlanGenerationInFlightError) {
          throw new EngineError(ENGINE_ERROR_CODES.PLAN_GENERATION_IN_FLIGHT, cause.message, { cause });
        }
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to generate task plan");
      }
    },
    // Generated plans are persisted solely by commitTaskPlanGeneration.
    async stopGeneration(input: { taskId: string; workBlockId?: string | null }) {
      return taskPlanning.stopGeneration(input);
    },
    async patch(input: Parameters<typeof taskPlanning.patch>[0]) {
      try {
        return await taskPlanning.patch(input);
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.VALIDATION_FAILED,
          "Failed to apply plan patch",
        );
      }
    },
    async mutate(input: Parameters<typeof taskPlanning.mutate>[0]) {
      try {
        return await taskPlanning.mutate(input);
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.VALIDATION_FAILED,
          "Failed to apply plan mutation",
        );
      }
    },
  };
}

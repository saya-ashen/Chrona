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
  getState(input: { taskId: string }): Promise<{
    taskId: string;
    aiPlanGenerationStatus:
      | "accepted"
      | "generating"
      | "idle"
      | "waiting_acceptance";
    savedPlan: TaskPlanReadModel | null;
    generationSession: TaskPlanGenerationSessionReadModel | null;
  }>;
  getActiveGeneration(input: { taskId: string }): {
    generationSession: TaskPlanGenerationSessionReadModel | null;
  };
  getGenerationSession(input: { generationId: string }): {
    generationSession: TaskPlanGenerationSessionReadModel | null;
  };
  subscribeToActiveGeneration(input: {
    taskId: string;
    onEvent: (event: GeneratePlanSSEEvent) => void;
  }): ReturnType<typeof taskPlanning.subscribeToActiveGeneration>;
  subscribeToGeneration(input: {
    generationId: string;
    onEvent: (event: GeneratePlanSSEEvent) => void;
  }): ReturnType<typeof taskPlanning.subscribeToGeneration>;
  accept(input: {
    taskId: string;
    planId: string;
    workspaceId?: string;
  }): Promise<{ savedPlan: TaskPlanReadModel | null }>;
  generate(input: { taskId: string; forceRefresh?: boolean }): {
    generationId: string;
    events: AsyncGenerator<GeneratePlanSSEEvent>;
    emit: (event: GeneratePlanSSEEvent) => void;
    finish: () => void;
  };
  stopGeneration(input: { taskId: string }): {
    taskId: string;
    stopped: boolean;
  };
  patch(
    input: Parameters<typeof taskPlanning.patch>[0],
  ): ReturnType<typeof taskPlanning.patch>;
};

export function createTaskPlanService(): TaskPlanService {
  return {
    async getState(input: { taskId: string }) {
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
    getActiveGeneration(input: { taskId: string }) {
      return taskPlanning.getActiveGeneration(input);
    },
    getGenerationSession(input: { generationId: string }) {
      return taskPlanning.getGenerationSession(input);
    },
    subscribeToActiveGeneration(input: {
      taskId: string;
      onEvent: (event: GeneratePlanSSEEvent) => void;
    }) {
      return taskPlanning.subscribeToActiveGeneration(input);
    },
    subscribeToGeneration(input: {
      generationId: string;
      onEvent: (event: GeneratePlanSSEEvent) => void;
    }) {
      return taskPlanning.subscribeToGeneration(input);
    },
    async accept(input: {
      taskId: string;
      planId: string;
      workspaceId?: string;
    }) {
      try {
        return await taskPlanning.accept(input);
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.PLAN_NOT_FOUND,
          "Failed to accept task AI plan",
        );
      }
    },
    generate(input: { taskId: string; forceRefresh?: boolean }) {
      try {
        return taskPlanning.generate(input);
      } catch (cause) {
        if (cause instanceof TaskPlanGenerationInFlightError) {
          throw new EngineError(
            ENGINE_ERROR_CODES.PLAN_GENERATION_IN_FLIGHT,
            cause.message,
            { cause },
          );
        }
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.VALIDATION_FAILED,
          "Failed to generate task plan",
        );
      }
    },
    stopGeneration(input: { taskId: string }) {
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
  };
}

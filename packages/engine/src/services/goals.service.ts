import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import {
  applyGoalReview,
  confirmGoalCriterion,
  actOnGoal,
  createGoal,
  createGoalTask,
  getGoal,
  getGoalArtifact,
  listGoals,
  processGoalResult,
  promoteTaskToGoal,
  updateGoal,
  updateGoalBrief,
  updateGoalWorkingSet,
} from "../modules/goals/goals";

export function createGoalsService() {
  return {
    async list(input: Parameters<typeof listGoals>[0]) {
      try {
        return await listGoals(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to list Goals");
      }
    },
    async get(input: Parameters<typeof getGoal>[0]) {
      try {
        return await getGoal(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get Goal");
      }
    },
    async create(input: Parameters<typeof createGoal>[0]) {
      try {
        return await createGoal(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to create Goal");
      }
    },
    async update(input: Parameters<typeof updateGoal>[0]) {
      try {
        return await updateGoal(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to update Goal");
      }
    },
    async action(input: Parameters<typeof actOnGoal>[0]) {
      try {
        return await actOnGoal(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to apply Goal action");
      }
    },
    async updateBrief(input: Parameters<typeof updateGoalBrief>[0]) {
      try {
        return await updateGoalBrief(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to update Goal brief");
      }
    },
    async updateWorkingSet(input: Parameters<typeof updateGoalWorkingSet>[0]) {
      try {
        return await updateGoalWorkingSet(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to update Goal working set");
      }
    },
    async createTask(input: Parameters<typeof createGoalTask>[0]) {
      try {
        return await createGoalTask(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to create Goal task");
      }
    },
    async processResult(input: Parameters<typeof processGoalResult>[0]) {
      try {
        return await processGoalResult(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to process Goal result");
      }
    },
    async confirmCriterion(input: Parameters<typeof confirmGoalCriterion>[0]) {
      try {
        return await confirmGoalCriterion(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to confirm Goal criterion");
      }
    },
    async applyReview(input: Parameters<typeof applyGoalReview>[0]) {
      try {
        return await applyGoalReview(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to apply Goal review");
      }
    },
    async getArtifact(input: Parameters<typeof getGoalArtifact>[0]) {
      try {
        return await getGoalArtifact(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to get Goal artifact");
      }
    },
    async promoteTask(input: Parameters<typeof promoteTaskToGoal>[0]) {
      try {
        return await promoteTaskToGoal(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to promote task to Goal");
      }
    },
  };
}

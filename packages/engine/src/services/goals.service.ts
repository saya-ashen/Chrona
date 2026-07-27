import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import {
  applyGoalReview,
  applyGoalReviewProposal,
  confirmGoalCriterion,
  actOnGoal,
  createGoal,
  createGoalWithFirstTask,
  createGoalTask,
  generateGoalReview,
  getGoal,
  getGoalArtifact,
  listGoals,
  readGoalAcceptedResults,
  processGoalResult,
  promoteTaskToGoal,
  reviewGoalCriterion,
  rejectGoalReviewProposal,
  updateGoal,
  updateGoalBrief,
} from "../modules/goals/goals";

export type GoalAcceptedResultsReader = {
  readAcceptedResults(input: Parameters<typeof readGoalAcceptedResults>[0]): ReturnType<typeof readGoalAcceptedResults>;
};

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
    async readAcceptedResults(input: Parameters<typeof readGoalAcceptedResults>[0]) {
      try {
        return await readGoalAcceptedResults(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to read Goal accepted results");
      }
    },
    async create(input: Parameters<typeof createGoal>[0]) {
      try {
        return await createGoal(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to create Goal");
      }
    },
    async createWithFirstTask(input: Parameters<typeof createGoalWithFirstTask>[0]) {
      try {
        return await createGoalWithFirstTask(input);
      } catch (error) {
        throw engineErrorFromUnknown(error, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to create Goal with first task");
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
    async reviewCriterion(input: Parameters<typeof reviewGoalCriterion>[0]) {
      try {
        return await reviewGoalCriterion(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to review Goal criterion");
      }
    },
    async applyReview(input: Parameters<typeof applyGoalReview>[0]) {
      try {
        return await applyGoalReview(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to apply Goal review");
      }
    },
    async generateReview(input: Parameters<typeof generateGoalReview>[0]) {
      try {
        return await generateGoalReview(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to generate Goal review");
      }
    },
    async applyReviewProposal(input: Parameters<typeof applyGoalReviewProposal>[0]) {
      try {
        return await applyGoalReviewProposal(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to apply Goal review proposal");
      }
    },
    async rejectReviewProposal(input: Parameters<typeof rejectGoalReviewProposal>[0]) {
      try {
        return await rejectGoalReviewProposal(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to reject Goal review proposal");
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

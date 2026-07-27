import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import { tasks } from "../modules/tasks";
import { finalizeTaskResult } from "../modules/plan-execution";

export function createTaskResultService() {
  return {
    async accept(input: Parameters<typeof tasks.acceptResult>[0]) {
      try {
        return await tasks.acceptResult(input);
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.INVALID_TASK_STATE,
          "Failed to accept task result",
        );
      }
    },
    async retryFinalization(input: Parameters<typeof finalizeTaskResult>[0]) {
      try {
        const planOutput = await finalizeTaskResult({ ...input, force: true });
        return {
          taskId: input.taskId,
          finalizedResult: planOutput.finalizedResult,
          finalization: planOutput.finalization,
        };
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.INVALID_TASK_STATE,
          "Failed to finalize task result",
        );
      }
    },
    async continueFromResult(
      input: Parameters<typeof tasks.continueFromResult>[0],
    ) {
      try {
        return await tasks.continueFromResult(input);
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.INVALID_TASK_STATE,
          "Failed to continue from task result",
        );
      }
    },
    async getFollowUpState(
      input: Parameters<typeof tasks.getResultFollowUpState>[0],
    ) {
      try {
        return await tasks.getResultFollowUpState(input);
      } catch (cause) {
        throw engineErrorFromUnknown(
          cause,
          ENGINE_ERROR_CODES.INVALID_TASK_STATE,
          "Failed to get task result follow-up state",
        );
      }
    },
  };
}

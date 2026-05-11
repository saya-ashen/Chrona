import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import { taskScheduling } from "../modules/scheduling";

export function createTaskScheduleService() {
  return {
    async apply(input: Parameters<typeof taskScheduling.apply>[0]) {
      try {
        return await taskScheduling.apply(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to apply schedule");
      }
    },
    async clear(input: Parameters<typeof taskScheduling.clear>[0]) {
      try {
        return await taskScheduling.clear(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to clear schedule");
      }
    },
    async propose(input: Parameters<typeof taskScheduling.propose>[0]) {
      try {
        return await taskScheduling.propose(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to propose schedule");
      }
    },
    async decideProposal(input: Parameters<typeof taskScheduling.decideProposal>[0]) {
      try {
        return await taskScheduling.decideProposal(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to decide schedule proposal");
      }
    },
  };
}

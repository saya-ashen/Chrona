import { applySchedule } from "../modules/scheduling/apply-schedule";
import { clearSchedule } from "../modules/scheduling/clear-schedule";
import { decideScheduleProposal } from "../modules/scheduling/decide-schedule-proposal";
import { proposeSchedule } from "../modules/scheduling/propose-schedule";
import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";

export function createTaskScheduleService() {
  return {
    async apply(input: Parameters<typeof applySchedule>[0]) {
      try {
        return await applySchedule(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to apply schedule");
      }
    },
    async clear(input: Parameters<typeof clearSchedule>[0]) {
      try {
        return await clearSchedule(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to clear schedule");
      }
    },
    async propose(input: Parameters<typeof proposeSchedule>[0]) {
      try {
        return await proposeSchedule(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Failed to propose schedule");
      }
    },
    async decideProposal(input: Parameters<typeof decideScheduleProposal>[0]) {
      try {
        return await decideScheduleProposal(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Failed to decide schedule proposal");
      }
    },
  };
}

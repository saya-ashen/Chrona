import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import { generateDashboardBrief, pageQuery } from "../modules/pages";

export function createPagesService() {
  return {
    async getSchedule(input: { workspaceId: string }) {
      try {
        return await pageQuery.getSchedule(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get schedule page");
      }
    },
    async getInbox(input: { workspaceId: string }) {
      try {
        return await pageQuery.getInbox(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get inbox");
      }
    },
    async getDashboard(input: { workspaceId: string }) {
      try {
        return await pageQuery.getDashboard(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get dashboard");
      }
    },
    async generateDashboardBrief(input: { workspaceId: string; force?: boolean }) {
      try {
        const dashboard = await pageQuery.getDashboard(input);
        return await generateDashboardBrief({
          workspaceId: input.workspaceId,
          force: input.force,
          fingerprintInput: {
            needsAttention: dashboard.needsAttention,
            inProgress: dashboard.inProgress,
            autoCompleted: dashboard.autoCompleted,
            recentEvents: dashboard.recentEvents,
            totalAutoCompleted: dashboard.totalAutoCompleted,
          },
        });
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to generate dashboard AI brief");
      }
    },
    async getMemory(input: { workspaceId: string }) {
      try {
        return await pageQuery.getMemory(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get memory console");
      }
    },
  };
}

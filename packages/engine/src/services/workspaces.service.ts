import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";
import { workspaceQuery } from "../modules/workspaces";

export function createWorkspacesService() {
  return {
    async list() {
      try {
        return await workspaceQuery.list();
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get workspaces");
      }
    },
    async getDefault() {
      try {
        return await workspaceQuery.getDefault();
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.WORKSPACE_NOT_FOUND, "Failed to get default workspace");
      }
    },
    async getOverview(input: { workspaceId: string }) {
      try {
        return await workspaceQuery.getOverview(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.WORKSPACE_NOT_FOUND, "Failed to get workspace overview");
      }
    },
    async getStartWithChronaPreference(input: { workspaceId: string }) {
      try {
        return await workspaceQuery.getStartWithChronaPreference(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.WORKSPACE_NOT_FOUND, "Failed to get workspace preference");
      }
    },
    async setStartWithChronaPreference(input: { workspaceId: string; completedAt: string | null }) {
      try {
        return await workspaceQuery.setStartWithChronaPreference(input);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.WORKSPACE_NOT_FOUND, "Failed to update workspace preference");
      }
    },
  };
}

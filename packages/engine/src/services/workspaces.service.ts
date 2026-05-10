import { getDefaultWorkspace } from "../modules/workspaces/get-default-workspace";
import { getWorkspaceOverview } from "../modules/queries/get-workspace-overview";
import { getWorkspaces } from "../modules/queries/get-workspaces";
import { ENGINE_ERROR_CODES, engineErrorFromUnknown } from "../errors";

export function createWorkspacesService() {
  return {
    async list() {
      try {
        return await getWorkspaces();
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.VALIDATION_FAILED, "Failed to get workspaces");
      }
    },
    async getDefault() {
      try {
        return await getDefaultWorkspace();
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.WORKSPACE_NOT_FOUND, "Failed to get default workspace");
      }
    },
    async getOverview(input: { workspaceId: string }) {
      try {
        return await getWorkspaceOverview(input.workspaceId);
      } catch (cause) {
        throw engineErrorFromUnknown(cause, ENGINE_ERROR_CODES.WORKSPACE_NOT_FOUND, "Failed to get workspace overview");
      }
    },
  };
}

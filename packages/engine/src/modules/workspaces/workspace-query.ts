import { getDefaultWorkspace } from "./get-default-workspace";
import { getWorkspaceOverview } from "./get-workspace-overview";
import { getWorkspaces } from "./get-workspaces";

export class WorkspaceQuery {
  list() {
    return getWorkspaces();
  }

  getDefault() {
    return getDefaultWorkspace();
  }

  getOverview(input: { workspaceId: string }) {
    return getWorkspaceOverview(input.workspaceId);
  }
}

export const workspaceQuery = new WorkspaceQuery();

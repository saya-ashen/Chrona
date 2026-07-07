import { getDefaultWorkspace } from "./get-default-workspace";
import { getWorkspaceOverview } from "./get-workspace-overview";
import { getWorkspaces } from "./get-workspaces";
import { getStartWithChronaPreference, setStartWithChronaPreference } from "./start-with-chrona-preference";

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

  getStartWithChronaPreference(input: { workspaceId: string }) {
    return getStartWithChronaPreference(input.workspaceId);
  }

  setStartWithChronaPreference(input: { workspaceId: string; completedAt: string | null }) {
    return setStartWithChronaPreference(input);
  }
}

export const workspaceQuery = new WorkspaceQuery();

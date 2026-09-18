import { getDefaultWorkspace } from "../workspaces";
import { WorkResultError } from "../results/access";
import { createWorkRecordsService } from "./service";
/** Owner authority is checked inside each transaction; not proof of human identity. */
export function createLocalWorkRecordsService(authorizeOwner: () => Promise<boolean>) {
  return createWorkRecordsService({ async authorize() {
    if (!await authorizeOwner()) throw new WorkResultError("AUTH_REQUIRED", "Owner authorization is required");
    const workspace = await getDefaultWorkspace();
    return { workspaceId: workspace.id, actorKey: "owner:local", canWrite: true, canResolve: true };
  } });
}

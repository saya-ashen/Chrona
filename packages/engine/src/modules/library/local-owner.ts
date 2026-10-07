import { getDefaultWorkspace } from "../workspaces";
import { WorkResultError } from "../results/access";
import { createLibraryService } from "./service";
/** Owner authority, not proof that a person made a network request. */
export function createLocalLibraryService(authorizeOwner: () => Promise<boolean>) {
  return createLibraryService({ async authorize() {
    if (!await authorizeOwner()) throw new WorkResultError("AUTH_REQUIRED", "Owner authorization is required");
    const workspace = await getDefaultWorkspace();
    return { workspaceId: workspace.id, actorKey: "owner:local", isOwner: true, canOrganize: true, canConfigure: true };
  } });
}

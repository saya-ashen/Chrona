import { createLibraryService } from "../library/service";
import { refreshManagementClient, type ManagementIdentity } from "./clients";
import { requireScopes } from "./reads";
import { WorkResultError } from "../results/access";
import { ManagementError } from "./errors";
const methods = { chrona_library_read: "read", chrona_library_update: "write" } as const;
export function isLibraryTool(name: string): name is keyof typeof methods { return Object.hasOwn(methods, name); }
export async function callManagementLibrary(identity: ManagementIdentity, name: keyof typeof methods, raw: unknown) {
  const service = createLibraryService({ async authorize(permission) {
    try {
      const client = await refreshManagementClient(identity);
      requireScopes(client, ["tasks:read", "library:read", ...(permission === "organize" ? ["library:organize" as const] : []), ...(permission === "configure" ? ["library:configure" as const] : [])]);
      return { workspaceId: client.workspaceId, actorKey: `external:${client.id}`, isOwner: false, canOrganize: client.scopes.includes("library:organize"), canConfigure: client.scopes.includes("library:configure") };
    } catch { throw new WorkResultError("FORBIDDEN", "Current library authorization is required"); }
  } });
  try { return await service[methods[name]](raw); }
  catch (error) {
    if (error instanceof WorkResultError) throw new ManagementError(error.code, error.message, undefined, error.code === "STORAGE_ERROR");
    throw error;
  }
}

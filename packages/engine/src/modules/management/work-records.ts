import { createWorkRecordsService } from "../work-records/service";
import { refreshManagementClient, type ManagementIdentity } from "./clients";
import { requireScopes } from "./reads";
import { WorkResultError } from "../results/access";
import { ManagementError } from "./errors";
const methods = { chrona_work_search: "search", chrona_work_read: "read", chrona_work_capture: "capture", chrona_work_update: "update" } as const;
export function isWorkRecordTool(name: string): name is keyof typeof methods { return Object.hasOwn(methods, name); }
export async function callManagementWorkRecord(identity: ManagementIdentity, name: keyof typeof methods, raw: unknown) {
  const service = createWorkRecordsService({ async authorize(write) {
    try {
      const client = await refreshManagementClient(identity);
      requireScopes(client, ["tasks:read", "work:read", ...(write ? ["work:write"] : [])]);
      return { workspaceId: client.workspaceId, actorKey: `external:${client.id}`, canWrite: client.scopes.includes("work:write"), canResolve: false };
    } catch { throw new WorkResultError("FORBIDDEN", "Current work-record authorization is required"); }
  } });
  try { return await service[methods[name]](raw); }
  catch (error) {
    if (error instanceof WorkResultError) throw new ManagementError(error.code, error.message, undefined, error.code === "STORAGE_ERROR");
    throw error;
  }
}

import { RESULT_REQUEST_BYTES, RESULT_SCOPES, ARTIFACT_SCOPES, PAGE_SCOPES } from "@chrona/contracts/results";
import { WorkResultError, type ResultPermission } from "../results/access";
import { assertResultEntryEnabled } from "../results/entry-policy";
import { createTaskResultsService } from "../results/service";
import { resultFileAvailable } from "../results/file-storage";
import { refreshManagementClient, type ManagementIdentity } from "./clients";
import { ManagementError } from "./errors";
import { requireScopes } from "./reads";

const resultTools = ["chrona_result_read", "chrona_result_submit", "chrona_result_review", "chrona_result_file", "chrona_page_catalog", "chrona_page_validate", "chrona_page_read"] as const;
export type ResultToolName = typeof resultTools[number];
export function isWorkResultTool(name: string): name is ResultToolName {
  return (resultTools as readonly string[]).includes(name);
}
export function managementRequestLimit(name: string) {
  return isWorkResultTool(name) ? RESULT_REQUEST_BYTES : 65_536;
}

/** No caller-supplied actor or second ManagementCommand writer. The shared service
 * refreshes the real credential inside its transaction, including on replay. */
export async function callManagementWorkResult(identity: ManagementIdentity, name: ResultToolName, raw: unknown) {
  const service = createTaskResultsService({
    async authorize(_scope, permission) {
      try {
        const client = await refreshManagementClient(identity);
        if (permission === "pages:respond") throw new WorkResultError("FORBIDDEN", "Management clients cannot submit user responses");
        requireScopes(client, ["tasks:read", "results:read", permission]);
        assertResultEntryEnabled(permission);
        return { workspaceId: client.workspaceId, actorKind: "external", actorId: client.id,
          permissions: client.scopes.filter((scope): scope is Exclude<ResultPermission, "pages:respond"> => ([...RESULT_SCOPES, ...ARTIFACT_SCOPES, ...PAGE_SCOPES] as readonly string[]).includes(scope)) };
      } catch (error) {
        if (error instanceof ManagementError && (error.code === "AUTH_REQUIRED" || error.code === "FORBIDDEN")) {
          throw new WorkResultError(error.code, "Current management authorization is required for this result operation");
        }
        throw error;
      }
    },
    artifactAvailable: resultFileAvailable,
  });
  try {
    if (name === "chrona_page_catalog") return await service.pageCatalog(raw);
    if (name === "chrona_page_validate") return await service.pageValidate(raw);
    if (name === "chrona_page_read") return await service.pageRead(raw);
    if (name === "chrona_result_file") return await service.file(raw);
    if (name === "chrona_result_read") return await service.read(raw);
    if (name === "chrona_result_submit") return await service.publish(raw);
    return await service.review(raw);
  } catch (error) {
    if (error instanceof WorkResultError) throw new ManagementError(error.code, error.message, undefined, error.code === "STORAGE_ERROR");
    throw error;
  }
}

import { db } from "@chrona/db";
import { RESULT_SCOPES, ARTIFACT_SCOPES, PAGE_SCOPES } from "@chrona/contracts/results";
import { WorkResultError } from "./access";
import { assertResultEntryEnabled } from "./entry-policy";
import { createTaskResultsService } from "./service";
import { resultFileAvailable } from "./file-storage";

/** Trusted local owner API composition, not a management-client/auth fallback.
 * The HTTP adapter rechecks its API-key/local-owner policy inside each transaction.
 * "human" denotes owner API authority, not proof a person performed the work. */
export function createLocalTaskResultsService(authorizeOwner: () => Promise<boolean>) {
  return createTaskResultsService({
    async authorize(scope, permission) {
      if (!await authorizeOwner()) return null;
      assertResultEntryEnabled(permission);
      const task = await db.task.findUnique({ where: { id: scope.taskId }, select: { workspaceId: true } });
      if (!task) throw new WorkResultError("NOT_FOUND", "Task not found");
      return { workspaceId: task.workspaceId, actorKind: "human", actorId: "local-owner", permissions: [...RESULT_SCOPES, ...ARTIFACT_SCOPES, ...PAGE_SCOPES, "pages:respond"] };
    },
    artifactAvailable: resultFileAvailable,
  });
}

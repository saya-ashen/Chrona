import { randomUUID } from "node:crypto";
import { db } from "@chrona/db";
import type { PublishWorkResult } from "@chrona/contracts/results";
import { workResultScopeKey } from "@chrona/domain/task/work-results";
import { authorizeResult, contentArtifactRefs, requireResultPermission, resultActorKey, WorkResultError, type ResultPrincipal, type TaskResultsPorts } from "./access";
import { resolveResultArtifacts } from "./artifacts";
import { assertResultRevision, findWorkResult, newResultReceipt, recordResultEvent, replayResultCommand, saveResultCommand, scopeOf } from "./commands";
import { resultPayloadHash } from "./content-hash";
import { contentHasPage } from "./page-policy";

function versionSource(principal: ResultPrincipal, source: PublishWorkResult["source"]) {
  return { sourceKind: principal.actorKind, actorKey: resultActorKey(principal), sourceLabel: source?.label, sourceWorkId: source?.workId,
    sourceReportedAt: source?.reportedAt ? new Date(source.reportedAt) : undefined };
}

async function authorizePageChange(ports: TaskResultsPorts, principal: ResultPrincipal, input: PublishWorkResult, previous: unknown) {
  if (input.content.page || contentHasPage(previous)) {
    requireResultPermission(principal, "pages:read");
    await authorizeResult(ports, scopeOf(input), "pages:write");
  }
}
async function authorizePageReplay(ports: TaskResultsPorts, principal: ResultPrincipal, input: PublishWorkResult, versionId: string) {
  if (input.content.page) return;
  const stored = await db.taskResultVersion.findUnique({ where: { id: versionId }, select: { parent: { select: { content: true } } } });
  await authorizePageChange(ports, principal, input, stored?.parent?.content);
}

/** DB transaction is owned by the service, including fresh authorization and the receipt. */
export async function publishWorkResult(ports: TaskResultsPorts, input: PublishWorkResult) {
  const scope = scopeOf(input);
  const principal = await authorizeResult(ports, scope, "results:write");
  await authorizePageChange(ports, principal, input, undefined);
  if (contentArtifactRefs(input.content).length) requireResultPermission(principal, "artifacts:read");
  const payloadHash = resultPayloadHash(input);
  const replay = await replayResultCommand(principal, "publish", input.requestId, payloadHash);
  if (replay) {
    await authorizePageReplay(ports, principal, input, replay.receipt.versionId);
    return replay;
  }
  let result = await findWorkResult(principal, scope);
  assertResultRevision(result, input.expectedRevision);
  const bindings = await resolveResultArtifacts(ports, principal, scope, input.content);
  result ??= await db.taskResult.create({ data: { id: randomUUID(), workspaceId: principal.workspaceId, ...scope, scopeKey: workResultScopeKey(scope.occurrenceId) } });
  const parent = result.headVersionId ? await db.taskResultVersion.findUniqueOrThrow({ where: { id: result.headVersionId } }) : null;
  // Removing a page is also page authoring; legacy result writers cannot erase it.
  if (!input.content.page) await authorizePageChange(ports, principal, input, parent?.content);
  const version = await db.taskResultVersion.create({ data: { id: randomUUID(), resultId: result.id, version: (parent?.version ?? 0) + 1, parentVersionId: result.headVersionId,
    content: input.content, contentHash: resultPayloadHash(input.content), ...versionSource(principal, input.source) } });
  if (bindings.length) await db.resultVersionArtifact.createMany({ data: bindings.map((binding) => ({ ...binding, versionId: version.id })) });
  const update = await db.taskResult.updateMany({ where: { id: result.id, editRevision: result.editRevision, headVersionId: result.headVersionId },
    data: { headVersionId: version.id, editRevision: { increment: 1 } } });
  if (update.count !== 1) throw new WorkResultError("REVISION_CONFLICT", "Result changed during publication");
  const receipt = newResultReceipt({ ...result, editRevision: result.editRevision + 1 }, version.id, version.version, "publish");
  await saveResultCommand(principal, input.requestId, payloadHash, receipt);
  await recordResultEvent(principal, scope, receipt);
  return { replayed: false, receipt };
}

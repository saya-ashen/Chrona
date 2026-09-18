import { randomUUID } from "node:crypto";
import { db } from "@chrona/db";
import { workResultContentSchema, type ReviewWorkResult } from "@chrona/contracts/results";
import { deriveWorkResultState } from "@chrona/domain/task/work-results";
import { authorizeResult, requireResultPermission, resultActorKey, WorkResultError, type TaskResultsPorts } from "./access";
import { unavailableVersionArtifacts } from "./artifacts";
import { assertResultRevision, findWorkResult, newResultReceipt, recordResultEvent, replayResultCommand, saveResultCommand, scopeOf } from "./commands";
import { resultPayloadHash } from "./content-hash";
import { contentHasPage } from "./page-policy";

export async function reviewWorkResult(ports: TaskResultsPorts, input: ReviewWorkResult) {
  const scope = scopeOf(input);
  const principal = await authorizeResult(ports, scope, "results:review");
  requireResultPermission(principal, "results:read");
  const target = await db.taskResultVersion.findFirst({ where: { id: input.versionId, result: { taskId: scope.taskId, workspaceId: principal.workspaceId, occurrenceId: scope.occurrenceId } }, select: { content: true } });
  if (contentHasPage(target?.content)) requireResultPermission(principal, "pages:read");
  const payloadHash = resultPayloadHash(input);
  const replay = await replayResultCommand(principal, "review", input.requestId, payloadHash);
  if (replay) return replay;
  const result = await findWorkResult(principal, scope);
  if (!result) throw new WorkResultError("NOT_FOUND", "Result not found");
  assertResultRevision(result, input.expectedRevision);
  if (result.headVersionId !== input.versionId) throw new WorkResultError("REVISION_CONFLICT", "Only the current result head can be reviewed");
  const version = await db.taskResultVersion.findUniqueOrThrow({ where: { id_resultId: { id: input.versionId, resultId: result.id } } });
  if (input.decision === "accept") {
    const content = workResultContentSchema.parse(version.content);
    const unavailable = await unavailableVersionArtifacts(ports, principal, scope, version.id);
    const state = deriveWorkResultState({ ...result, selectedVersionId: version.id, readiness: content.readiness.status, unavailableRequiredArtifacts: unavailable.length });
    if (!state.canAcceptContent) throw new WorkResultError("PRECONDITION_FAILED", "Result content or required artifacts are not ready for acceptance");
  }
  const updatedResult = { ...result, editRevision: result.editRevision + 1, acceptedVersionId: input.decision === "accept" ? version.id : result.acceptedVersionId };
  const receipt = newResultReceipt(updatedResult, version.id, version.version, "review", randomUUID());
  await saveResultCommand(principal, input.requestId, payloadHash, receipt);
  await db.taskResultReview.create({ data: { id: receipt.reviewId!, resultId: result.id, versionId: version.id, commandId: receipt.commandId,
    revision: updatedResult.editRevision, decision: input.decision, feedback: input.feedback, actorKey: resultActorKey(principal) } });
  const update = await db.taskResult.updateMany({ where: { id: result.id, editRevision: result.editRevision, headVersionId: version.id },
    data: { editRevision: { increment: 1 }, acceptedVersionId: updatedResult.acceptedVersionId } });
  if (update.count !== 1) throw new WorkResultError("REVISION_CONFLICT", "Result changed during review");
  await recordResultEvent(principal, scope, receipt);
  return { replayed: false, receipt };
}

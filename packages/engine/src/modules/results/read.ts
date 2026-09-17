import { db, type TaskResult } from "@chrona/db";
import { workResultContentSchema, type ReadWorkResult } from "@chrona/contracts/results";
import { deriveWorkResultState, workResultRevision } from "@chrona/domain/task/work-results";
import { authorizeResult, WorkResultError, type TaskResultsPorts } from "./access";
import { unavailableVersionArtifacts } from "./artifacts";
import { findWorkResult, scopeOf } from "./commands";

const versionSelect = { id: true, resultId: true, version: true, parentVersionId: true, contentHash: true, sourceKind: true, actorKey: true, sourceLabel: true, sourceWorkId: true, sourceReportedAt: true, publishedAt: true } as const;
function resultInfo(result: TaskResult) {
  return { id: result.id, taskId: result.taskId, occurrenceId: result.occurrenceId, headVersionId: result.headVersionId,
    acceptedVersionId: result.acceptedVersionId, editRevision: workResultRevision(result) };
}
function pageWithinBudget<T>(items: T[], total: number, input: ReadWorkResult) {
  const result = [...items];
  while (Buffer.byteLength(JSON.stringify(result)) > 96 * 1024) result.pop();
  const next = input.offset + result.length;
  const hasMore = next < total;
  return { items: result, total, offset: input.offset, hasMore, nextOffset: hasMore && next <= 1_000_000 ? next : null, paginationLimitReached: hasMore && next > 1_000_000 };
}

export async function readWorkResult(ports: TaskResultsPorts, input: ReadWorkResult) {
  const scope = scopeOf(input);
  const principal = await authorizeResult(ports, scope, "results:read");
  const result = await findWorkResult(principal, scope);
  if (!result) {
    if (input.selection === "version") throw new WorkResultError("NOT_FOUND", "Result version not found");
    return { result: null, version: null };
  }
  if (input.view === "versions") {
    const where = { resultId: result.id };
    const rows = await db.taskResultVersion.findMany({ where, orderBy: { version: "desc" }, skip: input.offset, take: input.limit, select: versionSelect });
    return { result: resultInfo(result), versions: pageWithinBudget(rows, await db.taskResultVersion.count({ where }), input) };
  }
  const selectedId = input.selection === "version" ? input.versionId : input.selection === "accepted" ? result.acceptedVersionId : result.headVersionId;
  if (!selectedId) return { result: resultInfo(result), version: null };
  const version = await db.taskResultVersion.findFirst({ where: { id: selectedId, resultId: result.id }, select: { ...versionSelect, content: true } });
  if (!version) throw new WorkResultError("NOT_FOUND", "Result version not found in this scope");
  if (input.view === "reviews") {
    const where = { versionId: version.id, resultId: result.id };
    const rows = await db.taskResultReview.findMany({ where, select: { id: true, versionId: true, revision: true, decision: true, feedback: true, actorKey: true, createdAt: true }, orderBy: { revision: "desc" }, skip: input.offset, take: input.limit });
    return { result: resultInfo(result), versionId: version.id, reviews: pageWithinBudget(rows, await db.taskResultReview.count({ where }), input) };
  }
  const content = workResultContentSchema.parse(version.content);
  const unavailable = await unavailableVersionArtifacts(ports, principal, scope, version.id);
  return { result: resultInfo(result), version: { ...version, content }, unavailableRequiredArtifacts: unavailable,
    state: deriveWorkResultState({ ...result, selectedVersionId: version.id, readiness: content.readiness.status, unavailableRequiredArtifacts: unavailable.length }) };
}

import { db, Prisma, type TaskResult, type WorkPageInput } from "@chrona/db";
import { pageContinuationSchema, type PageContinuation, type PageEntry, type PageInputsView, type PageRead } from "@chrona/contracts/results";
import { WorkResultError } from "./access";

/** Latest saved values at an immutable request boundary, not the later current values. */
function snapshotFilter(request: WorkPageInput) {
  const cutoff = request.revision - 1;
  return Prisma.sql`e."resultId"=${request.resultId} AND e."revision"<=${cutoff}
    AND (e."kind"='note' OR (e."kind"='response' AND e."versionId"=${request.versionId}))
    AND NOT EXISTS (SELECT 1 FROM "WorkPageInput" n WHERE n."resultId"=e."resultId" AND n."entryKey"=e."entryKey" AND n."revision">e."revision" AND n."revision"<=${cutoff})`;
}
async function requestInScope(resultId: string, requestId?: string) {
  return db.workPageInput.findFirst({ where: { resultId, kind: "handoff", ...(requestId ? { id: requestId } : {}) }, orderBy: { revision: "desc" } });
}
export async function validatePageContinuation(result: TaskResult, report: PageContinuation | undefined) {
  if (!report) return;
  const request = await requestInScope(result.id, report.requestId);
  if (!request || request.versionId !== report.baseVersionId) throw new WorkResultError("VALIDATION_ERROR", "Continuation request/base version not found in this scope");
  if (!report.feedback.length) return;
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT e."id" FROM "WorkPageInput" e WHERE ${snapshotFilter(request)} AND e."id" IN (${Prisma.join(report.feedback.map((f) => f.entryId))})`);
  if (rows.length !== report.feedback.length) throw new WorkResultError("VALIDATION_ERROR", "Feedback must reference exact inputs in the request snapshot, not later edits or other scopes");
}
async function latestReport(resultId: string, requestId: string) {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "TaskResultVersion" WHERE "resultId"=${resultId} AND json_extract("content", '$.continuation.requestId')=${requestId} ORDER BY "version" DESC LIMIT 1`);
  if (!rows.length) return null;
  const version = await db.taskResultVersion.findUniqueOrThrow({ where: { id: rows[0].id } });
  const content = version.content as Record<string, unknown>;
  return { versionId: version.id, version: version.version, content: pageContinuationSchema.parse(content.continuation) };
}
export async function readPageHandoff(input: PageRead, result: TaskResult): Promise<Pick<PageInputsView, "entries" | "total" | "nextOffset" | "handoff">> {
  const request = await requestInScope(result.id, input.requestId);
  if (!request) {
    if (input.requestId) throw new WorkResultError("NOT_FOUND", "Continuation request not found in this scope");
    return { entries: [], total: 0, nextOffset: null, handoff: null };
  }
  const filter = snapshotFilter(request);
  const ids = await db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT e."id" FROM "WorkPageInput" e WHERE ${filter} ORDER BY e."revision" ASC LIMIT ${input.limit} OFFSET ${input.offset}`);
  const counts = await db.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`SELECT count(*) AS n FROM "WorkPageInput" e WHERE ${filter}`);
  const rows = await db.workPageInput.findMany({ where: { id: { in: ids.map((v) => v.id) } }, orderBy: { revision: "asc" } });
  const entries = rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) as PageEntry[];
  // Leave room for the bounded author report and request in the 128 KiB response.
  while (Buffer.byteLength(JSON.stringify(entries)) > 48 * 1024) entries.pop();
  const total = Number(counts[0]?.n ?? 0), next = input.offset + entries.length;
  const report = await latestReport(result.id, request.id);
  const newInputs = await db.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`SELECT count(DISTINCT "entryKey") AS n FROM "WorkPageInput" WHERE "resultId"=${result.id} AND "kind" IN ('note','response') AND "revision">${request.revision}`);
  return { entries, total, nextOffset: next < total ? next : null, handoff: {
    request: { ...request, createdAt: request.createdAt.toISOString() } as PageEntry,
    baseVersionId: request.versionId!, snapshotRevision: request.revision - 1, newInputCount: Number(newInputs[0]?.n ?? 0), latestReport: report,
    unaddressedCount: total - (report?.content.feedback.filter((f) => f.disposition === "incorporated").length ?? 0),
  } };
}

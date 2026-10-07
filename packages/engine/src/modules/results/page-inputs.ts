import { randomUUID } from "node:crypto";
import { db, Prisma, type TaskResult } from "@chrona/db";
import { PAGE_ENTRY_LIMIT, PAGE_WORKSPACE_ENTRY_LIMIT, workResultContentSchema, type PageRead, type PageWrite, type PageEntry, type PageInputsView } from "@chrona/contracts/results";
import { validatePageAnswers } from "@chrona/ui-protocol/work-pages";
import { workResultScopeKey, workResultWritesAllowed } from "@chrona/domain/task/work-results";
import { authorizeResult, resultActorKey, WorkResultError, type TaskResultsPorts } from "./access";
import { findWorkResult, scopeOf } from "./commands";
import { resultPayloadHash } from "./content-hash";
import { pageWritesEnabled } from "./page-policy";
import { readPageHandoff } from "./page-continuation";
import { appendCanonicalEvent } from "../events";

function revision(result: TaskResult | null) { return result ? `page-input-v1:${result.id}:${result.inputRevision}` : null; }

export async function readPageInputs(ports: TaskResultsPorts, input: PageRead): Promise<PageInputsView> {
  const principal = await authorizeResult(ports, scopeOf(input), "pages:read");
  const result = await findWorkResult(principal, input);
  const task = await db.task.findUniqueOrThrow({ where: { id: input.taskId }, include: { workspace: { select: { status: true } } } });
  const canRespond = principal.actorKind === "human" && principal.permissions.includes("pages:respond") && pageWritesEnabled() && workResultWritesAllowed(task, task.workspace.status);
  const base = { revision: revision(result), headVersionId: result?.headVersionId ?? null, canRespond, view: input.view };
  if (!result) {
    if (input.requestId) throw new WorkResultError("NOT_FOUND", "Continuation request not found in this scope");
    return { ...base, entries: [], total: 0, nextOffset: null, handoff: null };
  }
  if (input.view === "handoff") return { ...base, ...await readPageHandoff(input, result) };
  if (input.versionId && !await db.taskResultVersion.findFirst({ where: { id: input.versionId, resultId: result.id }, select: { id: true } })) throw new WorkResultError("NOT_FOUND", "Page version not found in this scope");
  return { ...base, ...await pageEntries(input, result) };
}

async function pageEntries(input: PageRead, result: TaskResult) {
  const selected = input.versionId ?? result.headVersionId;
  const filter = Prisma.sql`e."resultId"=${result.id} ${input.kind ? Prisma.sql`AND e."kind"=${input.kind}` : Prisma.empty} ${input.view === "current" || input.versionId ? Prisma.sql`AND (e."kind"='note' OR e."versionId"=${selected})` : Prisma.empty}
    ${input.view === "current" ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "WorkPageInput" n WHERE n."resultId"=e."resultId" AND n."entryKey"=e."entryKey" AND n."revision">e."revision")` : Prisma.empty}`;
  const ids = await db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT e."id" FROM "WorkPageInput" e WHERE ${filter} ORDER BY e."revision" DESC LIMIT ${input.limit} OFFSET ${input.offset}`);
  const counts = await db.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`SELECT count(*) AS n FROM "WorkPageInput" e WHERE ${filter}`);
  const rows = await db.workPageInput.findMany({ where: { id: { in: ids.map((v) => v.id) } }, orderBy: { revision: "desc" } });
  const entries = rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) as PageEntry[];
  while (Buffer.byteLength(JSON.stringify(entries)) > 80 * 1024) entries.pop();
  const total = Number(counts[0]?.n ?? 0), next = input.offset + entries.length;
  return { entries, total, nextOffset: next < total ? next : null };
}

async function inputContent(action: PageWrite["action"], result: TaskResult | null) {
  if (action.type === "note") return { text: action.text };
  if (!result || result.headVersionId !== action.versionId) throw new WorkResultError("REVISION_CONFLICT", "The page changed. Read it again before saving");
  if (action.type === "handoff") return { text: action.text, snapshotRevision: result.inputRevision };
  const version = await db.taskResultVersion.findFirstOrThrow({ where: { id: action.versionId, resultId: result.id } });
  const form = workResultContentSchema.parse(version.content).page?.forms[action.formKey];
  if (!form) throw new WorkResultError("NOT_FOUND", "Form not found in this version");
  const validated = validatePageAnswers(form, action.answers);
  if (Object.keys(validated.errors).length) throw new WorkResultError("VALIDATION_ERROR", "Form answers do not match this version's fields");
  return { answers: validated.answers };
}
function inputIdentity(action: PageWrite["action"]) {
  if (action.type === "note") return { kind: "note", entryKey: `note:${action.noteId}`, versionId: null, formKey: null };
  if (action.type === "handoff") return { kind: "handoff", entryKey: `handoff:${randomUUID()}`, versionId: action.versionId, formKey: null };
  return { kind: "response", entryKey: `form:${action.versionId}:${action.formKey}`, versionId: action.versionId, formKey: action.formKey };
}
async function assertInputCapacity(result: TaskResult | null, workspaceId: string) {
  if ((result?.inputRevision ?? 0) >= PAGE_ENTRY_LIMIT || await db.workPageCommand.count({ where: { workspaceId } }) >= PAGE_WORKSPACE_ENTRY_LIMIT) throw new WorkResultError("PRECONDITION_FAILED", "Page input storage limit reached");
}

export async function writePageInput(ports: TaskResultsPorts, input: PageWrite) {
  const scope = scopeOf(input), principal = await authorizeResult(ports, scope, "pages:respond");
  if (principal.actorKind !== "human" || !principal.permissions.includes("pages:read")) throw new WorkResultError("FORBIDDEN", "Only the owner can record user input");
  if (!pageWritesEnabled()) throw new WorkResultError("PRECONDITION_FAILED", "Work page writes are disabled");
  const actorKey = resultActorKey(principal), payloadHash = resultPayloadHash(input);
  const old = await db.workPageCommand.findUnique({ where: { workspaceId_actorKey_requestId: { workspaceId: principal.workspaceId, actorKey, requestId: input.requestId } } });
  if (old) {
    if (old.payloadHash !== payloadHash) throw new WorkResultError("IDEMPOTENCY_CONFLICT", "Request ID already records different page input");
    return { replayed: true, receipt: old.receipt };
  }
  let result = await findWorkResult(principal, scope);
  if (revision(result) !== input.expectedRevision) throw new WorkResultError("REVISION_CONFLICT", "Input changed; read and reconcile. Your draft has not been saved");
  await assertInputCapacity(result, principal.workspaceId);
  const content = await inputContent(input.action, result);
  if (Buffer.byteLength(JSON.stringify(content)) > 32768) throw new WorkResultError("VALIDATION_ERROR", "Input exceeds 32 KiB");
  result ??= await db.taskResult.create({ data: { id: randomUUID(), workspaceId: principal.workspaceId, ...scope, scopeKey: workResultScopeKey(scope.occurrenceId) } });
  const next = result.inputRevision + 1;
  const entry = await db.workPageInput.create({ data: { id: randomUUID(), resultId: result.id, revision: next, ...inputIdentity(input.action), content, actorKey } });
  const changed = await db.taskResult.updateMany({ where: { id: result.id, inputRevision: result.inputRevision, headVersionId: result.headVersionId }, data: { inputRevision: next } });
  if (changed.count !== 1) throw new WorkResultError("REVISION_CONFLICT", "Page input changed concurrently");
  const receipt = { commandId: randomUUID(), entryId: entry.id, revision: revision({ ...result, inputRevision: next }), recordedAt: entry.createdAt.toISOString(), taskStatusChanged: false, executionStarted: false };
  await db.workPageCommand.create({ data: { id: receipt.commandId, workspaceId: principal.workspaceId, resultId: result.id, actorKey, requestId: input.requestId, payloadHash, receipt } });
  await appendCanonicalEvent({ eventType: "work_page.input_recorded", workspaceId: principal.workspaceId, taskId: scope.taskId, occurrenceId: scope.occurrenceId,
    actorType: "user", actorId: principal.actorId, source: "work_pages", correlationId: receipt.commandId, dedupeKey: `page:${receipt.commandId}`, summary: "Owner page input recorded",
    payload: { resultId: result.id, entryId: entry.id, kind: entry.kind, revision: next } });
  return { replayed: false, receipt };
}

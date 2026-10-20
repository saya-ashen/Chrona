import type { PrismaClient, Prisma } from "@chrona/db";
import { providerInteractionSchema, providerProgressSchema, providerResourcesSchema, providerRunViewSchema, providerUsageSchema, type ProviderInteraction, type ProviderRunView, type ProviderQuestion } from "@chrona/contracts/steward";
import { providerRequestStatus, providerRunActive } from "@chrona/domain/steward/provider";
import type { RecordContext } from "./affairs";
import { requireAffair } from "./affairs";

export const providerCancelKey = (runId: string) => `provider-cancel:${runId}`;
export const providerAnswerKey = (id: string) => `provider-answer:${id}`;
export async function providerReceipt(db: Prisma.TransactionClient, workspaceId: string, id: string, status: ProviderInteraction["status"], now: Date) {
  return db.audit.upsert({ where: { id: providerAnswerKey(id) }, update: {}, create: { id: providerAnswerKey(id), workspaceId, kind: "provider_answer", actorKey: status === "answered" ? "user" : "chrona", subjectId: id, details: { status, at: now.toISOString() } } });
}
export function providerJournal(db: PrismaClient, workspaceId: string, runId: string, now: () => Date) {
  let sequence = 0;
  return async (type: "progress" | "usage" | "resources", value: Prisma.InputJsonValue) => {
    if (++sequence > 300 && type === "progress") return;
    await db.audit.create({ data: { id: `provider:${runId}:${String(sequence).padStart(8, "0")}`, workspaceId, kind: "provider_event", actorKey: "chrona", subjectId: runId, details: { type, value, at: now().toISOString() } } });
  };
}
function eventValue(row: { details: unknown }) {
  const details = row.details as { type?: unknown; value?: unknown; at?: string } | null;
  return details ?? {};
}
export async function providerRuns(ctx: RecordContext, affairId: string | undefined, connected: (id: string) => boolean, waiting: (id: string) => boolean, liveQuestion: (id: string) => ProviderQuestion | null = () => null): Promise<ProviderRunView[]>  {
  const { db, workspaceId, now } = ctx;
  if (affairId) await requireAffair(db, workspaceId, affairId);
  const scope = { workspaceId, ...(affairId ? { affairId } : {}) };
  const [active, recent] = await Promise.all([
    db.run.findMany({ where: { ...scope, status: "running" }, include: { affair: true }, orderBy: { createdAt: "desc" }, take: 2 }),
    db.run.findMany({ where: scope, include: { affair: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 15 }),
  ]);
  const runs = [...new Map([...active, ...recent].map(run => [run.id, run])).values()];
  return Promise.all(runs.map(async run => {
    const [latest, requested] = await Promise.all([
      db.audit.findMany({ where: { workspaceId, subjectId: run.id, kind: "provider_event" }, orderBy: { id: "desc" }, take: 400 }),
      db.audit.findMany({ where: { workspaceId, subjectId: run.id, kind: "provider_question" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 12 }),
    ]);
    const records = latest.reverse();
    const questions = requested.flatMap(row => { const parsed = providerInteractionSchema.safeParse(row.details); return parsed.success ? [parsed.data] : []; });
    const receipts = await db.audit.findMany({ where: { workspaceId, kind: "provider_answer", subjectId: { in: questions.map(q => q.id) } } });
    const cancelling = await db.audit.findUnique({ where: { id: providerCancelKey(run.id) } });
    const alive = providerRunActive(run, connected(run.id) && !cancelling, now());
    const interactions = questions.map(question => {
      const receipt = receipts.find(row => row.subjectId === question.id)?.details as { status?: ProviderInteraction["status"] } | undefined;
      const status = providerRequestStatus(question, receipt?.status, alive, waiting(question.id), now());
      return { ...question, status, question: status === "pending" ? liveQuestion(question.id) ?? question.question : question.question };
    });
    const last = (type: string) => records.filter(row => row.kind === "provider_event").map(eventValue).findLast(value => value.type === type)?.value;
    const progress = providerProgressSchema.safeParse(last("progress")), usage = providerUsageSchema.safeParse(last("usage")), resources = providerResourcesSchema.safeParse(last("resources"));
    return providerRunViewSchema.parse({ id: run.id, affairId: run.affairId, affairTitle: run.affair?.title ?? null, active: alive, status: run.status,
      progress: progress.success ? progress.data : null, usage: usage.success ? usage.data : null, resources: resources.success ? resources.data : null,
      interactions, updatedAt: (run.endedAt ?? run.startedAt ?? run.createdAt).toISOString() });
  }));
}

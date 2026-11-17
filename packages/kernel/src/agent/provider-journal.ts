import type { PrismaClient, Prisma } from "@chrona/db";
import { providerInteractionSchema, providerProgressSchema, providerResourcesSchema, providerRunViewSchema, providerUsageSchema, type ProviderInteraction, type ProviderRunView, type ProviderQuestion } from "@chrona/contracts/steward";
import { providerRequestStatus, providerRunActive } from "@chrona/domain/steward/provider";
import { appendRunEventIn } from "../execution/run-events";
import type { StewardPorts } from "../ports";
type RecordContext = Pick<StewardPorts, "db" | "now"> & { workspaceId: string };

export async function providerReceipt(db: Prisma.TransactionClient, _workspaceId: string, id: string, status: ProviderInteraction["status"], now: Date) {
  return db.runInteraction.updateMany({ where: { id, status: "pending" }, data: { status, settledAt: now } });
}
export function providerJournal(db: PrismaClient, runId: string, now: () => Date) {
  let progress = 0, raw = 0, gap = false;
  return async (type: "progress" | "usage" | "resources" | "raw", value: Prisma.InputJsonValue) => {
    if (type === "progress" && ++progress > 300) return;
    if (type === "raw" && ++raw > 300) {
      if (gap) return;
      gap = true;
      value = { type: "chrona_raw_gap", reason: "retention_limit", retainedEvents: 300, detail: "Subsequent raw events are not retained for this Run" };
    }
    const at = now();
    await db.$transaction(tx => appendRunEventIn(tx, runId, type, { type, value, at: at.toISOString() }, at));
  };
}
function eventValue(row: { payload: unknown }) {
  const details = row.payload as { type?: unknown; value?: unknown; at?: string } | null;
  return details ?? {};
}
export async function providerRuns(ctx: RecordContext, { sessionId, ids }: { sessionId?: string; ids?: string[] }, connected: (id: string) => boolean, waiting: (id: string) => boolean, liveQuestion: (id: string) => ProviderQuestion | null = () => null): Promise<ProviderRunView[]>  {
  const { db, workspaceId, now } = ctx;
  const scope = { workspaceId, ...(sessionId ? { sessionId } : {}) };
  const [active, recent] = ids ? [[], await db.run.findMany({ where: { ...scope, id: { in: ids } } })] : await Promise.all([
    db.run.findMany({ where: { ...scope, status: "running" }, orderBy: { createdAt: "desc" }, take: 2 }),
    db.run.findMany({ where: scope, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 15 }),
  ]);
  const runs = [...new Map([...active, ...recent].map(run => [run.id, run])).values()];
  return Promise.all(runs.map(async run => {
    const [latest, requested] = await Promise.all([
      Promise.all(["progress", "usage", "resources"].map(kind => db.runEvent.findFirst({ where: { runId: run.id, kind }, orderBy: { sequence: "desc" } }))),
      db.runInteraction.findMany({ where: { runId: run.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 12 }),
    ]);
    const records = latest.filter(row => row !== null);
    const questions = requested.flatMap(row => { const parsed = providerInteractionSchema.safeParse(row.request); return parsed.success ? [parsed.data] : []; });
    const alive = providerRunActive(run, connected(run.id) && !run.cancelRequestedAt, now());
    const interactions = questions.map(question => {
      const receipt = requested.find(row => row.id === question.id);
      const status = providerRequestStatus(question, receipt?.status === "pending" ? undefined : receipt?.status as ProviderInteraction["status"], alive, waiting(question.id), now());
      return { ...question, status, question: status === "pending" ? liveQuestion(question.id) ?? question.question : question.question };
    });
    const last = (type: string) => records.map(eventValue).findLast(value => value.type === type)?.value;
    const progress = providerProgressSchema.safeParse(last("progress")), usage = providerUsageSchema.safeParse(last("usage")), resources = providerResourcesSchema.safeParse(last("resources"));
    return providerRunViewSchema.parse({ id: run.id, sessionId: run.sessionId, sessionTitle: null, active: alive, status: run.status,
      progress: progress.success ? progress.data : null, usage: usage.success ? usage.data : null, resources: resources.success ? resources.data : null,
      interactions, updatedAt: (run.endedAt ?? run.startedAt ?? run.createdAt).toISOString() });
  }));
}

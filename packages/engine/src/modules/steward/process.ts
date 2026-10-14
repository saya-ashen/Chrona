import { AssessorUnavailableError, type AssessmentProposal, type ConnectionKind } from "@chrona/contracts/steward";
import { stewardAssessmentProposalSchema as proposalSchema } from "@chrona/contracts/api";
import type { Prisma } from "@chrona/db";
import type { Context } from "./mappers";
import { assessmentAuthority, assessmentLink, eventEvidence, recordAssessmentEffects, threadAffair } from "./process-effects";

type Event = Prisma.InboundEventGetPayload<object>;
type SourceEvent = Prisma.InboundEventGetPayload<{ include: { connection: true } }>;

async function loadAssessmentContext(ctx: Context, event: SourceEvent) {
  const affairId = await threadAffair(ctx.db, event, ctx.actor.workspaceId);
  const affairs = await ctx.db.affair.findMany({ where: { workspaceId: ctx.actor.workspaceId } });
  return { affairId, affairs };
}

function assessmentInput(event: SourceEvent, { affairId, affairs }: Awaited<ReturnType<typeof loadAssessmentContext>>) {
  return {
    event: {
      id: event.id, externalId: event.externalId, title: event.title, body: event.body,
      author: event.author, url: event.url, occurredAt: event.occurredAt.toISOString(),
      threadId: event.threadId ?? undefined, connectionKind: event.connection.kind as ConnectionKind,
    },
    affair: affairs.find(a => a.id === affairId) ?? null,
    candidateAffairs: affairs.map(a => ({ id: a.id, title: a.title, keywords: a.keywords as string[] })),
  };
}

async function recordAssessmentFailure(ctx: Context, event: Event, now: Date, unavailable: boolean) {
  const workspaceId = ctx.actor.workspaceId, attempts = event.attempts + 1;
  const failed = !unavailable && attempts >= 5;
  const lastError = unavailable ? "Assessor unavailable" : "Assessment failed";
  await ctx.db.$transaction(async tx => {
    if ((await tx.stewardState.findUnique({ where: { workspaceId } }))?.assessorName === "external-agent") return;
    const changed = await tx.inboundEvent.updateMany({
      where: { id: event.id, status: "pending", attempts: event.attempts }, data: {
        attempts, nextAttemptAt: new Date(now.getTime() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 10))),
        lastError, status: failed ? "failed" : "pending",
      },
    });
    if (!changed.count) return;
    const state = { assessorName: ctx.assessor.name, assessorAvailable: !unavailable, assessorLastError: lastError, lastTickAt: now };
    await tx.stewardState.upsert({ where: { workspaceId }, create: { workspaceId, ...state }, update: state });
    if (failed) await tx.attentionItem.upsert({
      where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: `event:${event.id}:failure` } }, update: {}, create: {
        workspaceId, dedupeKey: `event:${event.id}:failure`, eventId: event.id, kind: "failure",
        title: "Event assessment failed", whatHappened: "Assessment failed after five attempts",
        whyItMatters: "This event has not been assessed", nextStep: "Review the source event", evidence: eventEvidence(event),
      },
    });
  });
}

/** Runs one database step in the service's serial queue; the default runs it directly. */
export type Serialize = <T>(step: () => Promise<T>) => Promise<T>;
const direct: Serialize = step => step();

/**
 * Database steps go through `serialize`; the assessor call does not, so a slow
 * model never holds the queue that every other steward request waits on. A
 * concurrent writer is safe: the claim in applyAssessment re-checks status.
 */
export async function processPendingEvents(ctx: Context, { limit = 50, serialize = direct }: { limit?: number; serialize?: Serialize } = {}) {
  const workspaceId = ctx.actor.workspaceId, now = ctx.now();
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("limit must be 1..500");
  const events = await serialize(async () => {
    if ((await ctx.db.stewardState.findUnique({ where: { workspaceId } }))?.assessorName === "external-agent") return [];
    return ctx.db.inboundEvent.findMany({
      where: { workspaceId, status: "pending", connection: { status: { in: ["active", "failing"] } }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }], take: limit, include: { connection: true },
    });
  });
  let assessed = 0;
  for (const event of events) {
    // Database context loading remains outside the assessor failure boundary.
    const input = await serialize(async () => assessmentInput(event, await loadAssessmentContext(ctx, event)));
    let proposal: AssessmentProposal;
    try {
      proposal = proposalSchema.parse(await ctx.assessor.assess(input));
    } catch (error) {
      const unavailable = error instanceof AssessorUnavailableError;
      await serialize(() => recordAssessmentFailure(ctx, event, now, unavailable));
      if (unavailable) break;
      continue;
    }
    if (await serialize(() => applyAssessment(ctx, event, proposal, ctx.assessor.name))) assessed++;
  }
  return { assessed };
}

export type AssessmentContext = Pick<Context, "db" | "actor" | "now">;
export async function applyAssessment(ctx: AssessmentContext, event: Prisma.InboundEventGetPayload<object>, raw: AssessmentProposal, assessorName: string) {
  const proposal = proposalSchema.parse(raw), workspaceId = ctx.actor.workspaceId, now = ctx.now();
  return ctx.db.$transaction(async tx => {
    const state = await tx.stewardState.findUnique({ where: { workspaceId } });
    if ((state?.assessorName === "external-agent") !== assessorName.startsWith("agent:")) return false;
    const current = await tx.inboundEvent.findFirst({ where: { id: event.id, workspaceId } });
    if (!current || current.status !== "pending") return false;
    event = current;
    const affairId = await threadAffair(tx, event, workspaceId);
    const affairs = await tx.affair.findMany({ where: { workspaceId } });
    // Pause/revoke also wins when it happens while the assessor is running.
    const source = await tx.sourceConnection.findUniqueOrThrow({ where: { id: event.connectionId } });
    if (!(assessorName.startsWith("agent:") ? ["active"] : ["active", "failing"]).includes(source.status)) return false;
    // Claim and all resulting writes commit together; crash rollback leaves pending.
    const claim = await tx.inboundEvent.updateMany({
      where: { id: event.id, status: "pending", attempts: event.attempts },
      data: { status: "assessed", nextAttemptAt: null, lastError: null },
    });
    if (!claim.count) return;
    const guessed = affairs.some(a => a.id === proposal.affairId) ? proposal.affairId : null;
    const link = assessmentLink(event, affairId, guessed);
    await tx.inboundEvent.update({ where: { id: event.id }, data: link });
    const delegation = await assessmentAuthority(tx, event, affairId, now);
    await recordAssessmentEffects(tx, {
      workspaceId, actorKey: ctx.actor.actorKey, now, event, proposal, assessorName, linked: link.affairId, delegation,
    });
    const stateName = assessorName.startsWith("agent:") ? "external-agent" : assessorName;
    const healthy = { assessorName: stateName, assessorAvailable: true, assessorLastError: null, lastTickAt: now };
    await tx.stewardState.upsert({ where: { workspaceId }, create: { workspaceId, ...healthy }, update: healthy });
    return true;
  });
}

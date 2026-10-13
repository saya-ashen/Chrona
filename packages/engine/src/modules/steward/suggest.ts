import { assessmentSchema } from "@chrona/contracts/steward";
import { applyRestraint, detectSuggestions, suggestionDedupeFamily, type SuggestionDecision, type SuggestionSnapshot } from "@chrona/domain/steward/suggestions";
import { affairView, attentionView, audit, followUpView, json, toolView, type Context } from "./mappers";

/** Proposals only: no authority, follow-ups, tools or outbound messages. */
export async function raiseSuggestions(ctx: Context) {
  const workspaceId = ctx.actor.workspaceId, now = ctx.now();
  const [affairs, attention, followUps, events, delegations, tools] = await Promise.all([
    ctx.db.affair.findMany({ where: { workspaceId } }),
    // Resolved decisions are also needed to prove wrap-up and retain restraint.
    ctx.db.attentionItem.findMany({ where: { workspaceId } }),
    ctx.db.followUp.findMany({ where: { workspaceId } }),
    ctx.db.inboundEvent.findMany({ where: { workspaceId, status: "assessed", occurredAt: { gte: new Date(now.getTime() - 30 * 86400_000), lte: now } }, include: { assessments: { where: { workspaceId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 1 } } }),
    ctx.db.delegation.findMany({ where: { workspaceId, status: "active", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    ctx.db.managedTool.findMany({ where: { workspaceId } }),
  ]);
  const affairViews = affairs.map(a => affairView(a));
  const recentDecisions: SuggestionDecision[] = attention.flatMap(row => {
    if (row.kind !== "suggestion" || !row.decision || !row.decidedAt) return [];
    const item = attentionView(row);
    return [{ dedupeFamily: suggestionDedupeFamily(row.dedupeKey), decision: item.decision!, decidedAt: item.decidedAt!, snoozedUntil: item.snoozedUntil }];
  });
  const snapshot: SuggestionSnapshot = {
    affairs: affairViews, attentionItems: attention.map(row => attentionView(row)),
    followUps: followUps.map(row => followUpView(row)),
    activeDelegations: delegations, managedTools: tools.map(row => toolView(row)), recentDecisions,
    assessedEvents: events.flatMap(event => {
      const assessment = event.assessments[0];
      if (!assessment) return [];
      const disposition = assessmentSchema.shape.disposition.parse(assessment.disposition);
      const text = `${assessment.whatHappened} ${assessment.whyItMatters} ${event.title} ${event.body}`.toLowerCase();
      const keyword = affairViews.find(a => a.id === event.affairId)?.keywords.map(k => k.toLowerCase()).find(k => text.includes(k));
      return [{ id: event.id, affairId: event.affairId, occurredAt: event.occurredAt.toISOString(), disposition, pattern: `${disposition}:${keyword ?? event.author.trim().toLowerCase()}` }];
    }),
  };
  const detected = detectSuggestions(snapshot, now.toISOString());
  const candidates = applyRestraint(detected, recentDecisions, now.toISOString()).filter(candidate => !attention.some(row =>
    row.kind === "suggestion" && suggestionDedupeFamily(row.dedupeKey) === suggestionDedupeFamily(candidate.dedupeKey) && row.cooldownUntil && row.cooldownUntil > now));
  let raised = 0;
  for (const candidate of candidates) {
    raised += await ctx.db.$transaction(async tx => {
      const where = { workspaceId_dedupeKey: { workspaceId, dedupeKey: candidate.dedupeKey } };
      if (await tx.attentionItem.findUnique({ where })) return 0;
      const rationale = candidate.handling?.rationale;
      const row = await tx.attentionItem.upsert({ where, update: {}, create: {
        workspaceId, dedupeKey: candidate.dedupeKey, kind: "suggestion", affairId: candidate.affairId,
        title: candidate.title, whatHappened: candidate.whatHappened,
        whyItMatters: rationale && !candidate.whyItMatters.includes(rationale) ? `${candidate.whyItMatters}\n${rationale}` : candidate.whyItMatters,
        nextStep: `${candidate.nextStep}\nGranting a delegation or enabling a tool is a separate explicit step.`,
        evidence: json(candidate.evidenceEventIds.flatMap(id => {
          const event = events.find(e => e.id === id);
          return event ? [{ eventId: id, label: event.title.slice(0, 200) || "Source event", excerpt: event.body.slice(0, 1000), observedAt: event.occurredAt.toISOString() }] : [];
        }).slice(0, 20)), createdAt: now, updatedAt: now,
      } });
      await audit(tx, ctx, "suggestion_raised", row.id, { dedupeKey: candidate.dedupeKey, proposes: candidate.proposes, handling: candidate.handling ?? null });
      return 1;
    });
  }
  return { raised, suppressed: detected.length - raised };
}

import { AssessorUnavailableError } from "@chrona/contracts/steward";
import type { Assessor, AssessmentProposal } from "@chrona/contracts/steward";

/**
 * Deterministic, deliberately limited English rules, in priority order:
 * 1. Deadline/date + request -> await_decision, notify_user, proposed follow-up.
 * 2. A question containing you/your -> notify_now, notify_user.
 * 3. newsletter/automated/no-action markers -> retain, no action.
 * 4. Everything else -> digest, summarize.
 * Dates: valid YYYY-MM-DD at UTC midnight; otherwise a deadline/tomorrow means
 * one day after occurredAt (not wall-clock time). Dates are proposals, not schedules.
 * Affair matching: case-insensitive literal keyword substring, exactly one distinct
 * candidate affair only. Text cannot supply permissions, destinations or executable
 * actions: all action values below are fixed local constants, never parsed from text.
 */
export function createRuleAssessor({ available }: { available: () => boolean }): Assessor {
  return {
    name: "rule-assessor-v1",
    async assess({ event, candidateAffairs }) {
      if (!available()) throw new AssessorUnavailableError();
      const text = `${event.title}\n${event.body}`;
      const normalized = text.toLowerCase();
      const matches = new Set(candidateAffairs.filter((affair) => affair.keywords.some((keyword) =>
        keyword.trim().length > 0 && normalized.includes(keyword.trim().toLowerCase()),
      )).map((affair) => affair.id));
      const dateText = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
      const parsedDate = dateText ? new Date(`${dateText}T00:00:00.000Z`) : null;
      const dueAt = parsedDate && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === dateText
        ? parsedDate.toISOString() : null;
      const deadline = dueAt !== null || /\b(deadline|due|tomorrow)\b/i.test(text);
      const request = /\b(please|request|could you|can you|would you|need you|must|confirm|approve|submit)\b/i.test(text);
      const proposal: AssessmentProposal = {
        disposition: "digest",
        whatHappened: (event.title.trim() || event.body.trim() || "Source event received").slice(0, 4000),
        whyItMatters: "No explicit urgent request; include in the digest.",
        nextStep: "Review in the next digest.", proposedAction: "summarize",
        affairId: matches.size === 1 ? [...matches][0] : null,
        followUp: null,
      };
      if (deadline && request) {
        const fallback = new Date(Date.parse(event.occurredAt) + 86_400_000);
        if (!dueAt && !Number.isFinite(fallback.getTime())) throw new Error("Invalid event occurredAt for follow-up proposal");
        return {
          ...proposal, disposition: "await_decision", proposedAction: "notify_user",
          whyItMatters: "A request includes a date or deadline; user confirmation is required.",
          nextStep: "Confirm the request and proposed follow-up; no external action has been authorized.",
          followUp: { note: "Review the dated request; confirm its deadline before acting.", dueAt: dueAt ?? fallback.toISOString() },
        };
      }
      if (/[?？]/.test(text) && /\b(you|your)\b/i.test(text)) {
        return { ...proposal, disposition: "notify_now", proposedAction: "notify_user",
          whyItMatters: "A question is addressed to you.", nextStep: "Review the question; decide whether to respond yourself." };
      }
      if (/\b(newsletter|automated|no[- ]action(?: required)?|no reply needed|do not reply)\b/i.test(text)) {
        return { ...proposal, disposition: "retain", proposedAction: null,
          whyItMatters: "Informational or automated message with no identified request.", nextStep: "Keep for reference." };
      }
      return proposal;
    },
  };
}

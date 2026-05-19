import type { AiProposalPreview } from "@chrona/contracts";
import { useI18n } from "@/i18n/client";

export function ProposalPreviewCard({ proposal }: { proposal: AiProposalPreview | null }) {
  const { t } = useI18n();
  if (!proposal) {
    return (
      <section className="rounded-3xl border border-dashed border-border/70 bg-white/75 p-4 text-sm text-muted-foreground" aria-labelledby="ai-preview-title">
        <h2 id="ai-preview-title" className="font-semibold text-foreground">{t("components.globalAiSidebar.preview")}</h2>
        <p className="mt-2">{t("components.globalAiSidebar.noPreview")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-primary/25 bg-primary-soft/60 p-4 shadow-sm" aria-labelledby="ai-preview-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{t("components.globalAiSidebar.preview")}</p>
          <h2 id="ai-preview-title" className="mt-1 text-base font-semibold text-foreground">{proposal.summary}</h2>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-primary">{proposal.confirmability}</span>
      </div>
      <p className="mt-2 text-sm text-slate-700">{proposal.explanation}</p>
      {proposal.taskPreview ? (
        <div className="mt-3 rounded-2xl bg-white/80 p-3 text-sm">
          <p className="font-medium text-foreground">{proposal.taskPreview.changeType}</p>
          <p className="mt-1 text-muted-foreground">{proposal.taskPreview.planDiffSummary}</p>
          {proposal.taskPreview.addedSteps.length > 0 ? <p className="mt-2 text-primary">{proposal.taskPreview.addedSteps.join(", ")}</p> : null}
        </div>
      ) : null}
      {proposal.schedulePreview ? (
        <div className="mt-3 space-y-2">
          {proposal.schedulePreview.placements.map((placement) => (
            <div key={`${placement.taskId}-${placement.startAt}`} className="rounded-2xl bg-white/85 p-3 text-sm">
              <p className="font-medium text-foreground">{placement.title}</p>
              <p className="mt-1 text-muted-foreground">{new Date(placement.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - {new Date(placement.endAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
              <p className="mt-1 text-xs text-primary">{placement.reason}</p>
            </div>
          ))}
        </div>
      ) : null}
      {proposal.confirmability === "stale" ? <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-700">{t("components.globalAiSidebar.staleWarning")}</p> : null}
    </section>
  );
}

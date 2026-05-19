"use client";

import { X } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { ContextSummaryCard } from "./context-summary-card";
import { ConversationThread } from "./conversation-thread";
import { ProposalPreviewCard } from "./proposal-preview-card";
import { QuickActionList } from "./quick-action-list";
import { useGlobalAiSidebar } from "./global-ai-sidebar-provider";

export function GlobalAiSidebar() {
  const { t } = useI18n();
  const sidebar = useGlobalAiSidebar();
  const confirmDisabled = sidebar.pendingProposal?.confirmability !== "confirmable";

  if (!sidebar.isOpen) return null;

  return (
    <aside
      aria-label={t("components.globalAiSidebar.panelLabel")}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col overflow-hidden border-l border-border/70 bg-slate-50/96 shadow-[-24px_0_70px_rgba(15,23,42,0.18)] sm:w-[420px]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border/70 bg-white px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{t("components.globalAiSidebar.eyebrow")}</p>
          <h1 className="text-lg font-semibold text-foreground">{t("components.globalAiSidebar.title")}</h1>
        </div>
        <button type="button" onClick={sidebar.close} aria-label={t("components.globalAiSidebar.close")} className="rounded-full border border-border/70 p-2 text-muted-foreground transition hover:text-foreground">
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
        <ContextSummaryCard context={sidebar.context} />
        <QuickActionList actions={sidebar.actions} onAction={sidebar.runQuickAction} />
        <ConversationThread messages={sidebar.messages} onSubmit={sidebar.submitFollowUp} />
        <ProposalPreviewCard proposal={sidebar.pendingProposal} />
      </div>
      {sidebar.pendingProposal ? (
        <footer className="border-t border-border/70 bg-white px-4 py-3" aria-live="polite">
          <div className="flex gap-2">
            <button type="button" onClick={() => void sidebar.confirmProposal()} disabled={confirmDisabled} className="flex-1 rounded-2xl bg-primary px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300">{sidebar.pendingProposal.confirmability === "applying" ? t("components.globalAiSidebar.applying") : t("components.globalAiSidebar.confirm")}</button>
            <button type="button" onClick={sidebar.dismissProposal} className="rounded-2xl border border-border/70 px-3 py-2 text-sm font-medium text-foreground">{t("components.globalAiSidebar.dismiss")}</button>
            <button type="button" onClick={sidebar.refineProposal} className="rounded-2xl border border-primary/30 px-3 py-2 text-sm font-medium text-primary">{t("components.globalAiSidebar.refine")}</button>
          </div>
          {sidebar.errorMessage ? <p className="mt-2 text-sm text-red-700">{sidebar.errorMessage}</p> : null}
        </footer>
      ) : null}
    </aside>
  );
}

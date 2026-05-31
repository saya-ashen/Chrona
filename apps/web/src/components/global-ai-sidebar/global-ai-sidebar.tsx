"use client";

import { X } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ContextSummaryCard } from "./context-summary-card";
import { ConversationThread } from "./conversation-thread";
import { ProposalPreviewCard } from "./proposal-preview-card";
import { QuickActionList } from "./quick-action-list";
import { useGlobalAiSidebar } from "./global-ai-sidebar-provider";

export function GlobalAiSidebar() {
  const { t } = useI18n();
  const sidebar = useGlobalAiSidebar();
  const confirmDisabled = sidebar.pendingProposal?.confirmability !== "confirmable";

  return (
    <Sheet open={sidebar.isOpen} onOpenChange={(open) => { if (!open) sidebar.close(); }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-label={t("components.globalAiSidebar.panelLabel")}
        className="w-full max-w-[440px] gap-0 overflow-hidden border-l border-border/70 bg-muted/40 p-0 shadow-2xl sm:w-[420px] sm:max-w-[420px]"
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 border-b border-border/70 bg-card px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <SheetDescription className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              {t("components.globalAiSidebar.eyebrow")}
            </SheetDescription>
            <SheetTitle className="text-lg font-semibold text-foreground">
              {t("components.globalAiSidebar.title")}
            </SheetTitle>
          </div>
          <SheetClose
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={t("components.globalAiSidebar.close")}
                className="rounded-full border-border/70 text-muted-foreground transition hover:text-foreground"
              />
            }
          >
            <X className="size-4" aria-hidden="true" />
          </SheetClose>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
          <ContextSummaryCard context={sidebar.context} />
          <QuickActionList actions={sidebar.actions} onAction={sidebar.runQuickAction} />
          <ConversationThread messages={sidebar.messages} onSubmit={sidebar.submitFollowUp} />
          <ProposalPreviewCard proposal={sidebar.pendingProposal} />
        </div>
        {sidebar.pendingProposal ? (
          <footer className="border-t border-border/70 bg-card px-4 py-3" aria-live="polite">
            <div className="flex gap-2">
              <Button type="button" onClick={() => void sidebar.confirmProposal()} disabled={confirmDisabled} className="flex-1 rounded-2xl">
                {sidebar.pendingProposal.confirmability === "applying" ? t("components.globalAiSidebar.applying") : t("components.globalAiSidebar.confirm")}
              </Button>
              <Button type="button" onClick={sidebar.dismissProposal} variant="outline" className="rounded-2xl border-border/70">
                {t("components.globalAiSidebar.dismiss")}
              </Button>
              <Button type="button" onClick={sidebar.refineProposal} variant="outline" className="rounded-2xl border-primary/30 text-primary">
                {t("components.globalAiSidebar.refine")}
              </Button>
            </div>
            {sidebar.errorMessage ? <p className="mt-2 text-sm text-destructive">{sidebar.errorMessage}</p> : null}
          </footer>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

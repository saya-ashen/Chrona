"use client";

import { useEffect } from "react";
import { ChevronDown, PanelTopOpen } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";
import { cn } from "@/lib/utils";
import { useAssistantSurface } from "./assistant-surface-provider";

export function AssistantSurfaceTrigger() {
  const { t } = useI18n();
  const assistant = useAssistantSurface();
  const activitySummary = assistant.state.summaries.find((item) => item.label === "Activity");
  const displaySummary = activitySummary ?? assistant.state.topSummary;
  const summaryLabel = activitySummary ? t("components.assistantSurface.activity") : displaySummary.label;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        assistant.toggle();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assistant]);

  return (
    <button
      type="button"
      data-assistant-surface-trigger="true"
      onClick={assistant.toggle}
      aria-expanded={assistant.isOpen}
      aria-haspopup="menu"
      aria-label={t("components.assistantSurface.entryLabel")}
      className={cn(
        "group inline-flex h-9 max-w-[72vw] items-center gap-2 border-b-2 px-1.5 text-sm transition-colors sm:max-w-[520px] sm:px-2",
        assistant.isOpen
          ? "border-primary text-primary"
          : "border-transparent text-slate-700 hover:border-primary/30 hover:text-primary",
      )}
    >
      <span className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full transition-colors",
        assistant.isOpen ? "bg-primary text-white" : "bg-primary-soft text-primary group-hover:bg-primary group-hover:text-white",
      )}>
        <PanelTopOpen className="size-3.5" />
      </span>
      <span className="h-4 w-px bg-border/70" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{summaryLabel}</span>
        <span className="min-w-0 max-w-[140px] truncate text-xs font-semibold text-primary sm:max-w-[260px] lg:max-w-[360px]">
          {displaySummary.value}
        </span>
      </span>
      <span className="flex shrink-0 text-muted-foreground">
        <ChevronDown className={cn("size-3.5 transition-transform", assistant.isOpen ? "rotate-180 text-primary" : "group-hover:text-primary")} />
      </span>
    </button>
  );
}

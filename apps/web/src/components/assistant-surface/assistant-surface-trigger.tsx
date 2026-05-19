"use client";

import { useEffect } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";
import { cn } from "@/lib/utils";
import { useAssistantSurface } from "./assistant-surface-provider";

export function AssistantSurfaceTrigger() {
  const { t } = useI18n();
  const assistant = useAssistantSurface();
  const summary = assistant.state.topSummary;
  const summaryLabel = summary.label === "Status" ? t("components.assistantSurface.signal") : summary.label;

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
        "group inline-flex h-9 max-w-[68vw] items-center gap-2 border-b-2 px-1.5 text-sm transition-colors sm:max-w-[440px] sm:px-2",
        assistant.isOpen
          ? "border-primary text-primary"
          : "border-transparent text-slate-700 hover:border-primary/30 hover:text-primary",
      )}
    >
      <span className="flex h-full items-center gap-2">
        <span className={cn(
          "flex size-5 items-center justify-center rounded-full transition-colors",
          assistant.isOpen ? "bg-primary text-white" : "bg-primary-soft text-primary group-hover:bg-primary group-hover:text-white",
        )}>
          <Sparkles className="size-3.5" />
        </span>
        <span className="hidden shrink-0 font-semibold tracking-tight sm:inline">{t("components.assistantSurface.entry")}</span>
      </span>
      <span className="h-4 w-px bg-border/70" aria-hidden="true" />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="hidden text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:inline">{summaryLabel}</span>
        <span className="min-w-0 max-w-[74px] truncate text-xs font-semibold text-primary sm:max-w-[128px]">
          {summary.value}
        </span>
      </span>
      <span className="hidden text-[11px] font-semibold text-muted-foreground/80 sm:inline">⌘K</span>
      <span className="flex text-muted-foreground">
        <ChevronDown className={cn("size-3.5 transition-transform", assistant.isOpen ? "rotate-180 text-primary" : "group-hover:text-primary")} />
      </span>
    </button>
  );
}

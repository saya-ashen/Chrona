"use client";

import { useEffect } from "react";
import { ChevronDown, PanelTopOpen } from "lucide-react";
import { useI18n } from "@chrona/i18n/react";
import { cn } from "@/lib/utils";
import { useAssistantSurface } from "./assistant-surface-provider";

export function AssistantSurfaceHeaderDrawerButton() {
  const { t } = useI18n();
  const assistant = useAssistantSurface();
  const displaySummary = assistant.state.topSummary;

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
      data-assistant-surface-header-drawer-button="true"
      onClick={assistant.toggle}
      aria-expanded={assistant.isOpen}
      aria-haspopup="menu"
      aria-label={t("components.assistantSurface.entryLabel")}
      className={cn(
        "group inline-flex h-9 max-w-[72vw] items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-2 text-sm transition-colors hover:border-primary/40 hover:bg-primary-soft/60 sm:max-w-[520px] sm:px-2.5",
        assistant.isOpen
          ? "border-primary/50 bg-primary-soft text-primary"
          : "text-muted-foreground hover:text-primary",
      )}
    >
      <span className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full transition-colors",
        assistant.isOpen ? "bg-primary text-primary-foreground" : "bg-primary-soft text-primary group-hover:bg-primary group-hover:text-primary-foreground",
      )}>
        <PanelTopOpen className="size-3.5" />
      </span>
      <span className="h-4 w-px bg-border/70" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{displaySummary.label}</span>
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

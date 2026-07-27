"use client";

import { useEffect } from "react";
import { ChevronDown, PanelTopOpen } from "lucide-react";
import { useI18n } from "@chrona/i18n";
import { cn } from "@shared/ui";
import { useAssistantSurface } from "./assistant-surface-provider";

type AssistantSurfaceHeaderDrawerButtonProps = {
  disabled?: boolean;
};

export function AssistantSurfaceHeaderDrawerButton({ disabled = false }: AssistantSurfaceHeaderDrawerButtonProps) {
  const { t } = useI18n();
  const assistant = useAssistantSurface();
  const displaySummary = assistant.state.topSummary;

  useEffect(() => {
    if (disabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        assistant.toggle();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assistant, disabled]);

  return (
    <button
      type="button"
      data-assistant-surface-header-drawer-button="true"
      onClick={disabled ? undefined : assistant.toggle}
      disabled={disabled}
      aria-disabled={disabled ? true : undefined}
      aria-expanded={disabled ? undefined : assistant.isOpen}
      aria-haspopup={disabled ? undefined : "menu"}
      aria-label={t("components.assistantSurface.entryLabel")}
      className={cn(
        "group inline-flex h-9 max-w-[520px] scroll-mb-24 items-center gap-2 overflow-hidden rounded-full border border-border/60 bg-muted/40 px-2.5 text-sm transition-colors",
        disabled
          ? "cursor-default text-muted-foreground"
          : assistant.isOpen
            ? "border-primary/50 bg-primary-soft text-primary"
            : "text-muted-foreground hover:border-primary/40 hover:bg-primary-soft/60 hover:text-primary",
      )}
    >
      <span className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full transition-colors",
        disabled ? "bg-primary-soft text-primary" : assistant.isOpen ? "bg-primary text-primary-foreground" : "bg-primary-soft text-primary group-hover:bg-primary group-hover:text-primary-foreground",
      )}>
        <PanelTopOpen className="size-3.5" />
      </span>
      <span className="hidden h-4 w-px bg-border/70 md:block" aria-hidden="true" />
      <span className="hidden min-w-0 flex-1 items-center gap-1.5 md:flex">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{displaySummary.label}</span>
        <span className="min-w-0 max-w-[220px] truncate text-xs font-semibold text-primary lg:max-w-[360px]">
          {displaySummary.value}
        </span>
      </span>
      <span className="flex shrink-0 text-muted-foreground">
        <ChevronDown className={cn("size-3.5 transition-transform", !disabled && assistant.isOpen ? "rotate-180 text-primary" : !disabled ? "group-hover:text-primary" : null)} />
      </span>
    </button>
  );
}

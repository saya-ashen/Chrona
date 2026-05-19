"use client";

import { Sparkles } from "lucide-react";
import { useEffect } from "react";
import { useI18n } from "@/i18n/client";
import { useGlobalAiSidebar } from "./global-ai-sidebar-provider";

export function GlobalAiSidebarEntry() {
  const { t } = useI18n();
  const { open } = useGlobalAiSidebar();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <button
      type="button"
      onClick={open}
      aria-label={t("components.globalAiSidebar.entryLabel")}
      className="inline-flex h-8 items-center gap-2 rounded-xl border border-primary/20 bg-primary-soft px-3 text-sm font-medium text-primary transition hover:bg-primary/12"
    >
      <Sparkles className="size-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">{t("components.globalAiSidebar.entry")}</span>
      <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold text-primary/80">⌘K</span>
    </button>
  );
}

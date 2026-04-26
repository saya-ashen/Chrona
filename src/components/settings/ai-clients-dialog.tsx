"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { AiClientsManager } from "@/components/settings/ai-clients-manager";
import { useI18n } from "@/i18n/client";
import { useAppRouter } from "@/lib/router";

type AiClientsDialogProps = {
  isOpen: boolean;
  closeHref: string;
};

export function AiClientsDialog({ isOpen, closeHref }: AiClientsDialogProps) {
  const { t } = useI18n();
  const router = useAppRouter();

  useEffect(() => {
    if (!isOpen) return;

    const handleClose = () => {
      router.push(closeHref);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeHref, isOpen, router]);

  if (!isOpen) return null;

  const handleClose = () => {
    router.push(closeHref);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-950/35" onClick={handleClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-clients-dialog-title"
        className="fixed left-1/2 top-1/2 z-50 flex h-[min(84vh,920px)] w-[min(960px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
          <div className="space-y-1">
            <h1 id="ai-clients-dialog-title" className="text-lg font-semibold tracking-tight text-foreground">
              {t("pages.settings.manageAiClients")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("pages.settings.aiClientsDescription")}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("common.close")}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <AiClientsManager />
        </div>
      </section>
    </>
  );
}

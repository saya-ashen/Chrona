"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { AdvancedSettingsPanel } from "@/components/settings/advanced-settings-panel";
import { useI18n } from "@/i18n/client";
import { useAppRouter } from "@/lib/router";

type WorkspaceSummary = {
  id: string;
  name: string;
  _count: {
    tasks: number;
  };
};

type AdvancedSettingsDialogProps = {
  isOpen: boolean;
  closeHref: string;
  workspaces: WorkspaceSummary[];
};

export function AdvancedSettingsDialog({ isOpen, closeHref, workspaces }: AdvancedSettingsDialogProps) {
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
        aria-labelledby="advanced-settings-dialog-title"
        className="fixed left-1/2 top-1/2 z-50 flex h-[min(82vh,860px)] w-[min(980px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
          <div className="space-y-1">
            <h1 id="advanced-settings-dialog-title" className="text-lg font-semibold tracking-tight text-foreground">
              {t("pages.settings.openAdvancedSettings")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("pages.settings.advancedDescription")}</p>
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
          <AdvancedSettingsPanel
            compact
            title={t("pages.advancedSettings.title")}
            subtitle={t("pages.advancedSettings.subtitle")}
            workspaceManagementTitle={t("pages.advancedSettings.workspaceManagementTitle")}
            workspaceManagementDescription={t("pages.advancedSettings.workspaceManagementDescription")}
            openWorkspaces={t("pages.advancedSettings.openWorkspaces")}
            taskCountOne={t("pages.advancedSettings.taskCountOne")}
            taskCountOther={t("pages.advancedSettings.taskCountOther")}
            workspaces={workspaces}
          />
        </div>
      </section>
    </>
  );
}

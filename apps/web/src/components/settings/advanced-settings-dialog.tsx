"use client";

import { X } from "lucide-react";
import { Button } from "@shared/ui"
import { Dialog,
DialogClose,
DialogContent,
DialogDescription,
DialogHeader,
DialogTitle, } from "@shared/ui"
import { useI18n } from "@chrona/i18n/react";
import { useAppRouter } from "@/lib/router";

type AdvancedSettingsDialogProps = {
  isOpen: boolean;
  closeHref: string;
};

export function AdvancedSettingsDialog({ isOpen, closeHref }: AdvancedSettingsDialogProps) {
  const { t } = useI18n();
  const router = useAppRouter();

  const handleClose = () => {
    router.push(closeHref);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(82vh,860px)] w-[min(980px,calc(100vw-32px))] max-w-none flex-col overflow-hidden rounded-[28px] border border-border/60 bg-background p-0 shadow-2xl"
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
              {t("pages.settings.openAdvancedSettings")}
            </DialogTitle>
            <DialogDescription>{t("pages.settings.advancedDescription")}</DialogDescription>
          </div>
          <DialogClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label={t("common.close")}
              />
            }
          >
            <X className="size-4" />
          </DialogClose>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{t("pages.advancedSettings.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("pages.advancedSettings.subtitle")}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

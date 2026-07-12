"use client";

import { X } from "lucide-react";
import { AiClientsManager } from "./ai-clients-manager";
import { Button } from "shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@chrona/i18n/react";
import { useAppRouter } from "@/lib/router";

type AiClientsDialogProps = {
  isOpen: boolean;
  closeHref: string;
};

export function AiClientsDialog({ isOpen, closeHref }: AiClientsDialogProps) {
  const { t } = useI18n();
  const router = useAppRouter();

  const handleClose = () => {
    router.push(closeHref);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(88dvh,860px)] w-[min(calc(100vw-2rem),1120px)] max-w-none flex-col overflow-hidden rounded-[24px] border border-border/60 bg-background p-0 shadow-2xl sm:!max-w-[1120px]"
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 border-b border-border/60 px-6 py-5">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
              {t("pages.settings.manageAiClients")}
            </DialogTitle>
            <DialogDescription>{t("pages.settings.aiClientsDescription")}</DialogDescription>
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
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">
          <AiClientsManager />
        </div>
      </DialogContent>
    </Dialog>
  );
}

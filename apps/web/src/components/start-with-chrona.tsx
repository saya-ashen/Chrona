"use client";

import { useEffect, useState } from "react";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { localizeHref } from "@chrona/i18n";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/api";
import { useAppRouter } from "@/lib/router";

type AiClientsResponse = {
  clients?: unknown[];
};

type StartWithChronaProps = {
  className?: string;
};

export function StartWithChrona({ className = "" }: StartWithChronaProps) {
  const { t } = useI18n();
  const locale = useLocale();
  const router = useAppRouter();
  const [hasClients, setHasClients] = useState(true);

  useEffect(() => {
    let cancelled = false;

    apiJson<AiClientsResponse>("/api/ai/clients")
      .then((payload) => {
        if (cancelled || !payload) return;
        setHasClients(Array.isArray(payload.clients) && payload.clients.length > 0);
      })
      .catch(() => {
        if (!cancelled) setHasClients(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (hasClients) return null;

  return (
    <section className={`rounded-3xl border border-primary/20 bg-primary-soft/70 p-4 text-sm shadow-sm ${className}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            {t("components.schedulePage.firstRunTitle")}
          </h2>
          <p className="max-w-3xl text-muted-foreground">
            {t("components.schedulePage.firstRunDescription")}
          </p>
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <span>{t("components.schedulePage.firstRunStepConnectAi")}</span>
            <span>{t("components.schedulePage.firstRunStepCreateTask")}</span>
            <span>{t("components.schedulePage.firstRunStepReviewPlan")}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            size="default"
            onClick={() => router.push(localizeHref(locale, "/settings?panel=ai-clients"))}
          >
            {t("components.schedulePage.firstRunConnectAi")}
          </Button>
        </div>
      </div>
    </section>
  );
}

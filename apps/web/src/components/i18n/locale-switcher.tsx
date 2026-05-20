"use client";

import { LocalizedLink } from "@/components/i18n/localized-link";
import { Button } from "@/components/ui/button";
import { useI18n } from "@chrona/i18n/react";
import { locales } from "@chrona/i18n";
import { localizeHref } from "@chrona/i18n";

export function LocaleSwitcher() {
  const { locale, t } = useI18n();

  return (
    <div className="flex items-center gap-1.5" aria-label={t("locale.label")}>
      {locales.map((candidate) => {
        const isActive = candidate === locale;

        return (
          <Button key={candidate} asChild variant={isActive ? "secondary" : "ghost"} size="sm" className="h-8 px-2 text-xs">
            <LocalizedLink href={localizeHref(candidate, "/schedule")}>
              {t(`locale.${candidate}`)}
            </LocalizedLink>
          </Button>
        );
      })}
    </div>
  );
}

"use client";

import { LocalizedLink } from "@/components/i18n/localized-link";
import { Button } from "shared/ui/button";
import { cn } from "@/lib/utils"
import { useI18n } from "@chrona/i18n/react";
import { locales } from "@chrona/i18n";
import { localizeHref } from "@chrona/i18n";

export function LocaleSwitcher() {
  const { locale, t } = useI18n();

  return (
    <div className="flex items-center gap-1 sm:gap-1.5" aria-label={t("locale.label")}>
      {locales.map((candidate) => {
        const isActive = candidate === locale;

        return (
          <Button key={candidate} asChild variant={isActive ? "secondary" : "ghost"} size="sm" className={cn("h-8 px-2 text-xs", !isActive && "hidden sm:inline-flex")}>
            <LocalizedLink href={localizeHref(candidate, "/schedule")}>
              <span className="sm:hidden">{candidate.toUpperCase()}</span>
              <span className="hidden sm:inline">{t(`locale.${candidate}`)}</span>
            </LocalizedLink>
          </Button>
        );
      })}
    </div>
  );
}

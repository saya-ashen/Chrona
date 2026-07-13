"use client";

import { localizeHref, locales, useI18n } from "@chrona/i18n";
import { Button, cn } from "@shared/ui";
import { LocalizedLink } from "./localized-link";

export function LocaleSwitcher() {
  const { locale, t } = useI18n();

  return (
    <div className="flex items-center gap-1 sm:gap-1.5" aria-label={t("locale.label")}>
      {locales.map((candidate) => {
        const isActive = candidate === locale;

        return (
          <Button
            key={candidate}
            asChild
            variant={isActive ? "secondary" : "ghost"}
            size="sm"
            className={cn("h-8 px-2 text-xs", !isActive && "hidden sm:inline-flex")}
          >
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

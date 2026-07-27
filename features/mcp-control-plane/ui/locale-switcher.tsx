"use client";

import { useLocation } from "react-router-dom";
import { localizeHref, locales, stripLocalePrefix, useI18n } from "@chrona/i18n";
import { Button, cn } from "@shared/ui";
import { LocalizedLink } from "./localized-link";

export function LocaleSwitcher() {
  const { locale, t } = useI18n();
  const location = useLocation();
  const route = `${stripLocalePrefix(location.pathname)}${location.search}${location.hash}`;

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
            <LocalizedLink href={localizeHref(candidate, route)}>
              <span>{t(`locale.${candidate}`)}</span>
            </LocalizedLink>
          </Button>
        );
      })}
    </div>
  );
}

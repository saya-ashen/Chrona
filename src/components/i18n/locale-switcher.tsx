"use client";

import { LocalizedLink } from "@/components/i18n/localized-link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";
import { locales } from "@/i18n/config";
import { localizeHref } from "@/i18n/routing";

export function LocaleSwitcher() {
  const { locale, t } = useI18n();

  return (
    <div className="flex items-center gap-1.5" aria-label={t("locale.label")}>
      {locales.map((candidate) => {
        const isActive = candidate === locale;

        return (
          <LocalizedLink
            key={candidate}
            href={localizeHref(candidate, "/schedule")}
            className={cn(
              buttonVariants({ variant: isActive ? "secondary" : "ghost", size: "sm" }),
              "h-8 px-2 text-xs",
            )}
          >
            {t(`locale.${candidate}`)}
          </LocalizedLink>
        );
      })}
    </div>
  );
}

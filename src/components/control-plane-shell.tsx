"use client";

import type { ReactNode } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/modules/ui/navigation";
import { useI18n } from "@/i18n/client";

type ControlPlaneShellProps = {
  children: ReactNode;
};

export function ControlPlaneShell({ children }: ControlPlaneShellProps) {
  const { t } = useI18n();

  return (
    <div className="flex h-screen flex-col bg-[linear-gradient(180deg,rgba(15,23,42,0.03),transparent_22%),linear-gradient(135deg,rgba(59,130,246,0.05),transparent_35%),linear-gradient(225deg,rgba(168,85,247,0.04),transparent_30%)] bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-6 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <LocalizedLink href="/schedule" aria-label={t("nav.brandTitle")} className="space-y-0.5">
              <span className="block text-base font-semibold tracking-tight">{t("nav.brandTitle")}</span>
              <span className="block text-xs text-muted-foreground">{t("nav.brandTagline")}</span>
            </LocalizedLink>
            <LocaleSwitcher />
          </div>
          <nav aria-label="Primary" className="flex flex-wrap items-center gap-1.5 text-sm">
            {NAV_ITEMS.map((item) => (
              <LocalizedLink
                key={item.href}
                href={item.href}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground")}
              >
                {t(item.labelKey)}
              </LocalizedLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col px-4 py-4 sm:px-6 xl:overflow-hidden">
        {children}
      </main>
    </div>
  );
}

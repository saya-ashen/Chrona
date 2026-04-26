"use client";

import type { ReactNode } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useAppPathname } from "@/lib/router";
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
  const pathname = useAppPathname() ?? "/schedule";

  return (
    <div className="flex h-screen flex-col bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_32%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.1),transparent_26%),linear-gradient(180deg,rgba(15,23,42,0.02),transparent_18%)] bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/80 supports-[backdrop-filter]:bg-background/70 supports-[backdrop-filter]:backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <LocalizedLink
              href="/schedule"
              aria-label={t("nav.brandTitle")}
              className="group flex min-w-0 items-center gap-3 rounded-2xl border border-border/50 bg-background/70 px-3 py-2 shadow-sm transition-colors hover:border-primary/30 hover:bg-background"
            >
              <img
                src="/chrona_icon_app.svg"
                alt=""
                aria-hidden="true"
                className="h-9 w-9 shrink-0 rounded-xl ring-1 ring-inset ring-primary/15"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-tight text-foreground">{t("nav.brandTitle")}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{t("nav.brandTagline")}</span>
              </span>
            </LocalizedLink>
            <div className="hidden lg:block">
              <LocaleSwitcher />
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <nav aria-label="Primary" className="flex flex-wrap items-center gap-1 rounded-2xl border border-border/50 bg-background/65 p-1 shadow-sm">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <LocalizedLink
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      buttonVariants({ variant: isActive ? "secondary" : "ghost", size: "sm" }),
                      "h-9 rounded-xl px-3 text-sm",
                      isActive ? "bg-foreground text-background shadow-sm hover:bg-foreground/90 hover:text-background" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(item.labelKey)}
                  </LocalizedLink>
                );
              })}
            </nav>
            <div className="lg:hidden">
              <LocaleSwitcher />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col px-4 py-4 sm:px-6 xl:overflow-hidden">
        {children}
      </main>
    </div>
  );
}

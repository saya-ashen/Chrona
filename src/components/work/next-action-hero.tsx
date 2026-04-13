"use client";

import type { ReactNode } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { StatusBadge } from "@/components/ui/status-badge";

type NextActionHeroProps = {
  title: string;
  description: string;
  whyNow: string;
  actionLabel: string;
  evidence: Array<{
    label: string;
    value: string;
    tone: "neutral" | "warning" | "critical";
    href?: string | null;
  }>;
  approvals?: ReactNode;
  composer: ReactNode;
  modeLabel: string;
  labels: {
    ariaLabel: string;
    badge: string;
    whyNow: string;
    evidence: string;
  };
};

function getEvidenceTone(tone: NextActionHeroProps["evidence"][number]["tone"]) {
  switch (tone) {
    case "critical":
      return "critical" as const;
    case "warning":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

function isSafeExternalHref(href: string) {
  try {
    const protocol = new URL(href).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" || protocol === "tel:";
  } catch {
    return false;
  }
}

function isInternalAppHref(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}

export function NextActionHero({
  title,
  description,
  whyNow,
  actionLabel,
  evidence,
  approvals,
  composer,
  modeLabel,
  labels,
}: NextActionHeroProps) {
  return (
    <section
      id="next-action-hero"
      aria-label={labels.ariaLabel}
      className="overflow-hidden rounded-[32px] border border-primary/20 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.94))] text-primary-foreground shadow-[0_24px_80px_-36px_rgba(15,23,42,0.95)]"
    >
      <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:gap-8">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">{labels.badge}</StatusBadge>
            <StatusBadge tone="warning">{modeLabel}</StatusBadge>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary-foreground/65">{actionLabel}</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-primary-foreground sm:text-3xl">{title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-primary-foreground/78">{description}</p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-foreground/65">{labels.whyNow}</p>
            <p className="mt-2 text-sm leading-6 text-primary-foreground/82">{whyNow}</p>
          </div>

          {evidence.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary-foreground/65">{labels.evidence}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {evidence.map((item) => (
                  <div key={`${item.label}-${item.value}`} className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={getEvidenceTone(item.tone)}>{item.label}</StatusBadge>
                    </div>
                    {item.href && isInternalAppHref(item.href) ? (
                      <LocalizedLink href={item.href} className="mt-3 inline-block text-sm text-primary-foreground underline decoration-white/35 underline-offset-4 hover:text-white">
                        {item.value}
                      </LocalizedLink>
                    ) : item.href && isSafeExternalHref(item.href) ? (
                      <a href={item.href} className="mt-3 inline-block text-sm text-primary-foreground underline decoration-white/35 underline-offset-4 hover:text-white">
                        {item.value}
                      </a>
                    ) : (
                      <p className="mt-3 text-sm text-primary-foreground/85">{item.value}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {approvals ? <div className="space-y-3">{approvals}</div> : null}
        </div>

        <div className="rounded-[28px] border border-white/12 bg-white/6 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-5">
          {composer}
        </div>
      </div>
    </section>
  );
}

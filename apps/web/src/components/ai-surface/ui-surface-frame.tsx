import type { ReactNode } from "react";
import { Activity, Bot, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type UiSurfaceKind = "product-authored" | "ai-authored" | "ai-editable" | "runtime-control";

type UiSurfaceFrameProps = {
  kind: UiSurfaceKind;
  label: string;
  children: ReactNode;
  description?: string;
  className?: string;
  bodyClassName?: string;
};

const SURFACE_COPY: Record<UiSurfaceKind, { badge: string; Icon: typeof ShieldCheck; className: string; iconClassName: string; badgeClassName: string }> = {
  "product-authored": {
    badge: "Product UI",
    Icon: ShieldCheck,
    className: "border-border/45 bg-background",
    iconClassName: "text-muted-foreground",
    badgeClassName: "border-border/60 bg-muted/35 text-muted-foreground",
  },
  "ai-authored": {
    badge: "AI generated",
    Icon: Bot,
    className: "border-violet-300/60 bg-violet-50/45 dark:border-violet-400/25 dark:bg-violet-950/10",
    iconClassName: "text-violet-600 dark:text-violet-300",
    badgeClassName: "border-violet-300/55 bg-violet-500/10 text-violet-700 shadow-sm shadow-violet-500/10 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-200",
  },
  "ai-editable": {
    badge: "AI editable",
    Icon: Sparkles,
    className: "border-amber-300/70 bg-amber-50/50 dark:border-amber-400/25 dark:bg-amber-950/10",
    iconClassName: "text-amber-600 dark:text-amber-300",
    badgeClassName: "border-amber-300/55 bg-amber-500/10 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200",
  },
  "runtime-control": {
    badge: "Runtime state",
    Icon: Activity,
    className: "border-sky-300/65 bg-sky-50/45 dark:border-sky-400/25 dark:bg-sky-950/10",
    iconClassName: "text-sky-600 dark:text-sky-300",
    badgeClassName: "border-sky-300/55 bg-sky-500/10 text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-200",
  },
};

export function UiSurfaceFrame({ kind, label, description, children, className, bodyClassName }: UiSurfaceFrameProps) {
  const surface = SURFACE_COPY[kind];
  const Icon = surface.Icon;

  return (
    <section
      aria-label={label}
      data-ui-surface-kind={kind}
      className={cn("rounded-xl border p-2", surface.className, className)}
    >
      <div className="pointer-events-none mb-2 flex items-start justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <div className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] backdrop-blur", surface.badgeClassName)}>
            <Icon className={cn("size-3", surface.iconClassName)} aria-hidden />
            <span>{surface.badge}</span>
          </div>
          {description ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

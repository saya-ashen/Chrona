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

const SURFACE_COPY: Record<UiSurfaceKind, { badge: string; Icon: typeof ShieldCheck; className: string; iconClassName: string }> = {
  "product-authored": {
    badge: "Product UI",
    Icon: ShieldCheck,
    className: "border-border/45 bg-background",
    iconClassName: "text-muted-foreground",
  },
  "ai-authored": {
    badge: "AI generated",
    Icon: Bot,
    className: "border-violet-300/60 bg-violet-50/45 dark:border-violet-400/25 dark:bg-violet-950/10",
    iconClassName: "text-violet-600 dark:text-violet-300",
  },
  "ai-editable": {
    badge: "AI editable",
    Icon: Sparkles,
    className: "border-amber-300/70 bg-amber-50/50 dark:border-amber-400/25 dark:bg-amber-950/10",
    iconClassName: "text-amber-600 dark:text-amber-300",
  },
  "runtime-control": {
    badge: "Runtime state",
    Icon: Activity,
    className: "border-sky-300/65 bg-sky-50/45 dark:border-sky-400/25 dark:bg-sky-950/10",
    iconClassName: "text-sky-600 dark:text-sky-300",
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
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Icon className={cn("size-3", surface.iconClassName)} aria-hidden />
            <span>{surface.badge}</span>
          </div>
          {description ? <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

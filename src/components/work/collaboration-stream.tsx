"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type CollaborationStreamItem = {
  id: string;
  kind: "decision" | "user" | "agent" | "event" | "approval" | "result";
  eyebrow: string;
  title: string;
  body: ReactNode;
  meta?: string | null;
  sectionId?: string;
  actions?: ReactNode;
};

type CollaborationStreamProps = {
  title: string;
  description?: string;
  items: CollaborationStreamItem[];
  emptyState: ReactNode;
  composer: ReactNode;
  composerTitle: string;
  composerLabel?: string;
  composerHint?: string;
  composerSectionId?: string;
  fixedHeightClassName?: string;
};

function getItemStyles(kind: CollaborationStreamItem["kind"]) {
  switch (kind) {
    case "user":
      return {
        wrapper: "ml-auto max-w-[92%]",
        card: "border-primary/15 bg-primary/[0.05]",
      };
    case "agent":
      return {
        wrapper: "mr-auto max-w-[92%]",
        card: "border-emerald-200/70 bg-emerald-50/60",
      };
    case "decision":
    case "approval":
      return {
        wrapper: "max-w-full",
        card: "border-amber-200/90 bg-amber-50/90 shadow-[0_8px_24px_-18px_rgba(245,158,11,0.7)]",
      };
    case "result":
      return {
        wrapper: "max-w-full",
        card: "border-sky-200/90 bg-sky-50/85 shadow-[0_8px_24px_-18px_rgba(14,165,233,0.6)]",
      };
    default:
      return {
        wrapper: "max-w-full",
        card: "border-border/60 bg-background/75 shadow-none",
      };
  }
}

export function CollaborationStream({
  title,
  description,
  items,
  emptyState,
  composer,
  composerTitle,
  composerLabel,
  composerHint,
  composerSectionId,
  fixedHeightClassName,
}: CollaborationStreamProps) {
  return (
    <section
      id="collaboration-flow"
      className={cn(
        "rounded-3xl border bg-card p-4 shadow-sm sm:p-5",
        fixedHeightClassName ?? "h-[720px]",
        "flex flex-col",
      )}
    >
      <div className="mx-auto max-w-[980px] space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>

      {composerSectionId ? <div id={composerSectionId} /> : null}

      <div
        id="work-composer"
        className="mx-auto mt-5 max-w-[980px] rounded-[28px] border border-primary/15 bg-primary/[0.03] p-4 shadow-sm"
      >
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{composerTitle}</h3>
          {composerLabel ? <p className="text-sm text-muted-foreground">{composerLabel}</p> : null}
          {composerHint ? <p className="text-xs text-muted-foreground">{composerHint}</p> : null}
        </div>
        <div className="mt-3">{composer}</div>
      </div>

      <div className="mx-auto mt-4 max-w-[980px] min-h-0 flex-1 overflow-y-auto space-y-3 pr-1">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
            {emptyState}
          </div>
        ) : (
          items.map((item) => {
            const styles = getItemStyles(item.kind);

            return (
              <article key={item.id} id={item.sectionId} className={styles.wrapper}>
                <div className={cn("rounded-[26px] border px-4 py-4 text-sm shadow-sm", styles.card)}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{item.eyebrow}</span>
                    {item.meta ? <span className="text-xs text-muted-foreground">{item.meta}</span> : null}
                  </div>
                  <p className="mt-2 font-medium text-foreground">{item.title}</p>
                  <div className="mt-2 whitespace-pre-wrap text-muted-foreground">{item.body}</div>
                  {item.actions ? <div className="mt-4">{item.actions}</div> : null}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

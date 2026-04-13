"use client";

import type { ReactNode } from "react";
import { StatusBadge } from "@/components/ui/status-badge";

type LatestResultPanelProps = {
  output: {
    title: string;
    body: string;
    timestamp: string | null;
    href: string | null;
    empty: boolean;
    sourceLabel: string;
  };
  updatedLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  previewTitle: string;
  previewItems: string[];
  error?: ReactNode;
  closure?: ReactNode;
  actions?: ReactNode;
  usedByNextAction?: boolean;
  labels: {
    ariaLabel: string;
    eyebrow: string;
    usedByNextAction: string;
    actionsTitle: string;
  };
};

export function LatestResultPanel({
  output,
  updatedLabel,
  emptyTitle,
  emptyDescription,
  previewTitle,
  previewItems,
  error,
  closure,
  actions,
  usedByNextAction = false,
  labels,
}: LatestResultPanelProps) {
  const content = output.empty ? (
    <div className="mt-4 space-y-4 text-sm text-muted-foreground">
      <p>{emptyDescription}</p>
      <div className="rounded-[20px] border border-dashed border-border/70 bg-muted/20 p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-foreground">{previewTitle}</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {previewItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <p>{output.body}</p>
    </div>
  ) : (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge>{output.sourceLabel}</StatusBadge>
        {usedByNextAction ? <StatusBadge tone="info">{labels.usedByNextAction}</StatusBadge> : null}
      </div>
      <article className="rounded-[22px] border border-border/60 bg-muted/[0.18] px-4 py-4">
        <div className="max-w-none whitespace-pre-wrap text-sm leading-7 text-foreground/[0.88]">{output.body}</div>
      </article>
    </div>
  );

  return (
    <section
      aria-label={labels.ariaLabel}
      id="latest-result"
      className="rounded-[24px] border border-border/70 bg-background/[0.88] p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)] sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{labels.eyebrow}</p>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            {output.empty ? emptyTitle : output.title}
          </h2>
        </div>
        {!output.empty && output.timestamp ? <p className="text-sm text-muted-foreground">{updatedLabel} {output.timestamp.slice(0, 16).replace("T", " ")}</p> : null}
      </div>

      <div className="mt-4 space-y-4">
        {content}
        {error ? <div>{error}</div> : null}
        {closure ? <div className="border-t border-border/60 pt-4">{closure}</div> : null}
        {actions ? (
          <div className="space-y-3 border-t border-border/60 pt-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{labels.actionsTitle}</p>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

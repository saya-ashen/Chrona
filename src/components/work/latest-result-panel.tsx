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
    <div className="mt-5 space-y-4 text-sm text-muted-foreground">
      <p>{emptyDescription}</p>
      <div className="rounded-[24px] border border-dashed border-border/70 bg-background/70 p-4">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-foreground">{previewTitle}</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {previewItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <p>{output.body}</p>
    </div>
  ) : (
    <div className="mt-5 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge>{output.sourceLabel}</StatusBadge>
        {usedByNextAction ? <StatusBadge tone="info">{labels.usedByNextAction}</StatusBadge> : null}
      </div>
      <article className="rounded-[26px] border border-border/60 bg-background/70 px-5 py-5 shadow-sm">
        <div className="max-w-none whitespace-pre-wrap text-sm leading-7 text-foreground/88">{output.body}</div>
      </article>
    </div>
  );

  return (
    <section aria-label={labels.ariaLabel} id="latest-result" className="rounded-[30px] border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{labels.eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {output.empty ? emptyTitle : output.title}
          </h2>
        </div>
        {!output.empty && output.timestamp ? <p className="text-sm text-muted-foreground">{updatedLabel} {output.timestamp.slice(0, 16).replace("T", " ")}</p> : null}
      </div>

      <div className="mt-5 space-y-5">
        {content}
        {error ? <div>{error}</div> : null}
        {closure ? <div className="border-t border-border/60 pt-4">{closure}</div> : null}
        {actions ? (
          <div className="space-y-3 border-t border-border/60 pt-4">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{labels.actionsTitle}</p>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

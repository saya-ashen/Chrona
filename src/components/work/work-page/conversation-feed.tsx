"use client";

import { cn } from "@/lib/utils";
import type { CollaborationFeedItem } from "./work-page-types";

type ConversationFeedProps = {
  items: CollaborationFeedItem[];
  emptyText: string;
};

export function ConversationFeed({ items, emptyText }: ConversationFeedProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-[24px] border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const alignClass = item.kind === "user" ? "ml-auto" : "mr-auto";
        const toneClass =
          item.kind === "user"
            ? "border-primary/15 bg-primary/[0.05]"
            : item.kind === "agent"
              ? "border-emerald-200/70 bg-emerald-50/60"
              : "border-border/60 bg-background/80";

        return (
          <article key={item.id} className={cn("max-w-[92%]", alignClass)}>
            <div
              className={cn(
                "rounded-[24px] border px-4 py-4 text-sm shadow-sm",
                toneClass,
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {item.eyebrow}
                </span>
                {item.meta ? (
                  <span className="text-xs text-muted-foreground">
                    {item.meta}
                  </span>
                ) : null}
              </div>

              <p className="mt-2 font-medium text-foreground">{item.title}</p>
              <div className="mt-2 whitespace-pre-wrap text-muted-foreground">
                {item.body}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

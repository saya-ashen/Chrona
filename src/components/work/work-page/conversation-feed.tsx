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
    <div className="space-y-4">
      {items.map((item) => {
        const alignClass = item.kind === "user" ? "ml-auto" : "mr-auto";
        const toneClass =
          item.kind === "user"
            ? "border-primary/[0.18] bg-primary/[0.08] shadow-sm"
            : item.kind === "agent"
              ? "border-border/80 bg-card shadow-sm"
              : "border-border/70 bg-muted/[0.2]";

        return (
          <article key={item.id} className={cn("max-w-[80%]", alignClass)}>
            <div
              className={cn(
                "rounded-[18px] border px-4 py-3 text-sm",
                toneClass,
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {item.eyebrow}
                </span>
                {item.meta ? (
                  <span className="text-xs text-muted-foreground">
                    {item.meta}
                  </span>
                ) : null}
              </div>

              <p className="mt-2 text-sm font-medium text-foreground/95">{item.title}</p>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/80">
                {item.body}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

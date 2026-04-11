"use client";

import { useI18n } from "@/i18n/client";

type ConversationPanelProps = {
  title?: string;
  description?: string;
  embedded?: boolean;
  entries: Array<{
    id: string;
    role: string;
    content: string;
    runtimeTs?: string | null;
  }>;
};

const DEFAULT_COPY = {
  title: "Conversation",
  noConversationYet: "No conversation mapped yet.",
} as const;

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace("T", " ") : "-";
}

function getEntryClasses(role: string) {
  const normalized = role.toLowerCase();

  if (normalized.includes("assistant") || normalized.includes("agent")) {
    return {
      wrapper: "mr-auto max-w-[88%]",
      card: "border-emerald-200/70 bg-emerald-50/60",
      badge: "border-emerald-200 bg-emerald-100/80 text-emerald-800",
    };
  }

  if (normalized.includes("user") || normalized.includes("operator") || normalized.includes("human")) {
    return {
      wrapper: "ml-auto max-w-[88%]",
      card: "border-primary/20 bg-primary/[0.06]",
      badge: "border-primary/20 bg-primary/10 text-primary",
    };
  }

  return {
    wrapper: "mx-auto max-w-full",
    card: "border-border/70 bg-background/80",
    badge: "border-border bg-background text-muted-foreground",
  };
}

export function ConversationPanel({ entries, title = "Conversation", description, embedded = false }: ConversationPanelProps) {
  const { messages } = useI18n();
  const copy = { ...DEFAULT_COPY, ...(messages.components?.conversationPanel ?? {}) };
  const content = (
    <>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{title === DEFAULT_COPY.title ? copy.title : title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">
        {entries.length === 0 ? (
          <p>{copy.noConversationYet}</p>
        ) : (
          entries.map((entry) => {
            const styles = getEntryClasses(entry.role);

            return (
              <div key={entry.id} className={styles.wrapper}>
                <div className={`rounded-2xl border px-3 py-3 shadow-sm ${styles.card}`}>
                  <div className="flex items-center justify-between gap-4">
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ${styles.badge}`}>
                      {entry.role}
                    </span>
                    <p className="text-xs">{formatDate(entry.runtimeTs)}</p>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-foreground/90">{entry.content}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );

  if (embedded) {
    return <div className="space-y-3">{content}</div>;
  }

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      {content}
    </section>
  );
}

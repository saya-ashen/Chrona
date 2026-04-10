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
          entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border bg-background px-3 py-3">
              <div className="flex items-center justify-between gap-4">
                <p className="font-medium uppercase tracking-wide text-foreground">{entry.role}</p>
                <p className="text-xs">{formatDate(entry.runtimeTs)}</p>
              </div>
              <p className="mt-2 whitespace-pre-wrap">{entry.content}</p>
            </div>
          ))
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

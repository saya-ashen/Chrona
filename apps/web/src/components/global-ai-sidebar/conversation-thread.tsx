"use client";

import { useState } from "react";
import type { AiSidebarMessage } from "@chrona/contracts";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/utils";

export function ConversationThread({ messages, onSubmit }: { messages: AiSidebarMessage[]; onSubmit: (message: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");

  return (
    <section className="rounded-3xl border border-border/60 bg-white p-4 shadow-sm" aria-labelledby="ai-conversation-title">
      <h2 id="ai-conversation-title" className="text-sm font-semibold text-foreground">{t("components.globalAiSidebar.conversation")}</h2>
      <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 px-3 py-3 text-sm text-muted-foreground">{t("components.globalAiSidebar.emptyConversation")}</p>
        ) : messages.map((message) => (
          <article key={message.id} className={cn("rounded-2xl px-3 py-2 text-sm", message.role === "user" ? "bg-primary-soft text-primary" : "bg-slate-50 text-foreground", message.responseKind === "error" && "bg-red-50 text-red-700")}>
            {message.content}
          </article>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(draft);
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t("components.globalAiSidebar.followUpPlaceholder")}
          className="min-w-0 flex-1 rounded-2xl border border-border/70 bg-white px-3 py-2 text-sm outline-none focus:border-primary/50"
        />
        <button type="submit" className="rounded-2xl bg-primary px-3 py-2 text-sm font-medium text-white">{t("components.globalAiSidebar.send")}</button>
      </form>
    </section>
  );
}

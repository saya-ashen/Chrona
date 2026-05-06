"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Sparkles, AlertTriangle, Check, X } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import type { TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";
import { api } from "@/lib/rpc-client";

type ChatHistoryEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposal?: TaskWorkspaceUpdateProposal | null;
  applied: boolean;
  sequence: number;
};

type CurrentTask = {
  title: string;
  description: string | null;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
  status: string;
};

type CurrentPlan = {
  id: string;
  status: string;
  revision: number;
  summary: string | null;
  nodes: Array<{
    id: string;
    title: string;
    objective: string;
    description: string | null;
    status: string;
    estimatedMinutes: number | null;
    priority: string | null;
    executionMode: string;
    dependsOn: string[];
  }>;
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    type: string;
  }>;
} | null;

type Props = {
  taskId: string;
  buildCurrentTask: () => CurrentTask;
  buildCurrentPlan: () => CurrentPlan;
  onProposal: (proposal: TaskWorkspaceUpdateProposal) => void;
  onApply?: (proposal: TaskWorkspaceUpdateProposal, messageId: string) => Promise<void>;
  onDismiss?: () => void;
  isApplying?: boolean;
};

async function loadMessages(taskId: string): Promise<ChatHistoryEntry[]> {
  try {
    const res = await api.tasks[":taskId"].assistant.messages.$get({
      param: { taskId },
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      messages: Array<{
        id: string;
        role: string;
        content: string;
        proposal?: Record<string, unknown> | null;
        applied: boolean;
        sequence: number;
      }>;
    };
    return data.messages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      proposal: m.proposal ? (m.proposal as TaskWorkspaceUpdateProposal) : null,
      applied: m.applied,
      sequence: m.sequence,
    }));
  } catch {
    return [];
  }
}

async function saveMessage(
  taskId: string,
  role: "user" | "assistant",
  content: string,
  proposal?: TaskWorkspaceUpdateProposal | null,
): Promise<ChatHistoryEntry | null> {
  try {
    const res = await api.tasks[":taskId"].assistant.messages.$post({
      param: { taskId },
      json: { role, content, proposal },
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      id: string;
      role: string;
      content: string;
      proposal?: Record<string, unknown> | null;
      applied: boolean;
      sequence: number;
    };
    return {
      id: data.id,
      role: data.role as "user" | "assistant",
      content: data.content,
      proposal: data.proposal ? (data.proposal as TaskWorkspaceUpdateProposal) : null,
      applied: data.applied,
      sequence: data.sequence,
    };
  } catch {
    return null;
  }
}

async function markMessageApplied(taskId: string, messageId: string): Promise<boolean> {
  try {
    const res = await api.tasks[":taskId"].assistant.messages[":messageId"].apply.$patch({
      param: { taskId, messageId },
    });
    return res.ok;
  } catch {
    return false;
  }
}

const SUGGESTIONS = [
  "Change the due date to tomorrow",
  "Add a testing step to the plan",
  "Make the prompt more creative",
  "Increase priority to High",
];

export function TaskWorkspaceAssistant({ taskId, buildCurrentTask, buildCurrentPlan, onProposal, onApply, onDismiss, isApplying }: Props) {
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<ChatHistoryEntry[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load history from DB on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const msgs = await loadMessages(taskId);
      if (!cancelled) {
        setHistory(msgs);
        setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, isSending]);

  const handleSend = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || isSending) return;

    setMessage("");
    setError(null);
    setIsSending(true);

    try {
      const currentTask = buildCurrentTask();
      const currentPlan = buildCurrentPlan();

      // Save user message to DB
      const userEntry = await saveMessage(taskId, "user", trimmed);
      if (!userEntry) throw new Error("Failed to save message");
      const newHistory = [...history, userEntry];

      const apiHistory = newHistory.map((h) => ({
        role: h.role,
        content: h.content,
      }));

      const response = await api.ai["task-workspace"].chat.$post({
        json: {
          taskId,
          message: trimmed,
          currentTask,
          currentPlan,
          history: apiHistory,
        },
      });

      if (!response.ok && response.status !== 503) {
        const err = await response.json().catch(() => ({ error: "Failed to send message" }));
        throw new Error((err as { error?: string }).error ?? "Failed to send message");
      }

      const data = (await response.json()) as {
        assistantMessage: string;
        proposal?: TaskWorkspaceUpdateProposal;
        error?: string;
      };

      // Save assistant response to DB
      const assistantEntry = await saveMessage(taskId, "assistant", data.assistantMessage, data.proposal ?? null);
      if (!assistantEntry) throw new Error("Failed to save assistant response");

      const updatedHistory = [...newHistory, assistantEntry];
      setHistory(updatedHistory);

      if (data.proposal) {
        onProposal(data.proposal);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to send message");
    } finally {
      setIsSending(false);
    }
  }, [message, isSending, history, taskId, buildCurrentTask, buildCurrentPlan, onProposal]);

  const handleApply = useCallback(async (entry: ChatHistoryEntry) => {
    if (!entry.proposal || !onApply) return;
    setApplyingMessageId(entry.id);
    try {
      await onApply(entry.proposal, entry.id);
      // After parent applies, mark as applied in DB + local state
      await markMessageApplied(taskId, entry.id);
      setHistory((prev) =>
        prev.map((h) => (h.id === entry.id ? { ...h, applied: true } : h)),
      );
    } finally {
      setApplyingMessageId(null);
    }
  }, [taskId, onApply]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <SurfaceCard className="sticky top-6 overflow-hidden flex flex-col" style={{ height: "calc(100vh - 9rem)" }} padding="md">
      <div className="shrink-0 space-y-3 pb-3 border-b border-border/60">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <Sparkles className="size-3" />
            Assistant
          </div>
          <Bot className="size-4 text-muted-foreground/40" />
        </div>
        <p className="text-xs text-muted-foreground">
          Describe changes to this task or plan — the assistant proposes updates for your review.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-3 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : history.length === 0 ? (
          <div className="space-y-1.5 py-2">
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setMessage(s);
                  inputRef.current?.focus();
                }}
                className="block w-full rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          history.map((entry) => (
            <div key={entry.id} className="space-y-1">
              <span className={cn(
                "text-[10px] font-medium uppercase tracking-[0.12em]",
                entry.role === "user" ? "text-muted-foreground/60" : "text-primary/60",
              )}>
                {entry.role === "user" ? "You" : "Assistant"}
              </span>
              <div
                className={cn(
                  "rounded-xl px-3 py-2 text-sm leading-relaxed",
                  entry.role === "user"
                    ? "bg-muted/40 text-foreground"
                    : "bg-primary/5 text-foreground border border-primary/10",
                )}
              >
                <p className="whitespace-pre-wrap">{entry.content}</p>
                {entry.proposal ? (
                  <div className="mt-2.5 space-y-2.5 pt-2.5 border-t border-border/40">
                    <p className="text-xs font-medium">{entry.proposal.summary}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      {entry.proposal.taskPatch ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                          Task changes
                        </span>
                      ) : null}
                      {entry.proposal.planPatch ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                          Plan changes
                        </span>
                      ) : null}
                      {entry.proposal.requiresConfirmation ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                          <AlertTriangle className="size-3" />
                          Requires confirmation
                        </span>
                      ) : null}
                    </div>
                    {onApply ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isApplying || entry.applied}
                          onClick={() => handleApply(entry)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                            entry.applied
                              ? "bg-emerald-100 text-emerald-700"
                              : entry.proposal.requiresConfirmation
                                ? "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                                : "bg-primary/10 text-primary hover:bg-primary/20",
                          )}
                        >
                          {entry.applied ? (
                            <Check className="size-3.5" />
                          ) : applyingMessageId === entry.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : entry.proposal.requiresConfirmation ? (
                            <AlertTriangle className="size-3.5" />
                          ) : null}
                          {applyingMessageId === entry.id
                            ? "Applying..."
                            : entry.applied
                              ? "Applied"
                              : entry.proposal.requiresConfirmation
                                ? "Accept & Apply"
                                : "Apply Changes"}
                        </button>
                        {onDismiss && !entry.applied ? (
                          <button
                            type="button"
                            disabled={isApplying}
                            onClick={onDismiss}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
                          >
                            <X className="size-3" />
                            Dismiss
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
        {isSending ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Thinking...
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 space-y-2 pt-3 border-t border-border/60">
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what to change..."
            rows={2}
            className="flex-1 resize-none rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={isSending || !message.trim()}
            className={cn(
              "shrink-0 rounded-xl p-2 transition-all",
              message.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/80"
                : "bg-muted/40 text-muted-foreground/40 cursor-not-allowed",
            )}
          >
            {isSending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
      </div>
    </SurfaceCard>
  );
}

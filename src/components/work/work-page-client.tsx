"use client";

import Link from "next/link";
import { startTransition, useEffect, useEffectEvent, useState } from "react";
import { ConversationPanel } from "@/components/work/conversation-panel";
import { ExecutionTimeline } from "@/components/work/execution-timeline";
import { RunSidePanel } from "@/components/work/run-side-panel";

type WorkPageClientProps = {
  initialData: {
    taskShell: {
      id: string;
      workspaceId: string;
      title: string;
      status: string;
      priority: string;
      dueAt: string | null;
      scheduledStartAt: string | null;
      scheduledEndAt: string | null;
      scheduleStatus: string;
      blockReason: {
        actionRequired?: string;
        blockType?: string;
        scope?: string;
        since?: string;
      } | null;
    };
    currentRun:
      | {
          id: string;
          status: string;
          startedAt?: string | null;
          endedAt?: string | null;
          syncStatus?: string | null;
          resumeSupported?: boolean | null;
          pendingInputPrompt?: string | null;
        }
      | null;
    timeline: Array<{
      id: string;
      eventType: string;
      payload: Record<string, unknown>;
      runtimeTs?: string | null;
    }>;
    conversation: Array<{ id: string; role: string; content: string; runtimeTs?: string | null }>;
    approvals: Array<{ id: string; title: string; status: string; summary?: string }>;
    artifacts: Array<{ id: string; title: string; type: string; uri?: string | null }>;
    toolCalls: Array<{
      id: string;
      toolName: string;
      status: string;
      argumentsSummary?: string | null;
      resultSummary?: string | null;
      errorSummary?: string | null;
    }>;
  };
};

function formatDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "-";
}

export function WorkPageClient({ initialData }: WorkPageClientProps) {
  const [data, setData] = useState(initialData);

  const refresh = useEffectEvent(async () => {
    const response = await fetch(`/api/work/${data.taskShell.id}/projection`, { cache: "no-store" });

    if (!response.ok) {
      return;
    }

    const next = (await response.json()) as WorkPageClientProps["initialData"];
    startTransition(() => setData(next));
  });

  useEffect(() => {
    if (!data.currentRun) {
      return;
    }

    const intervalMs = Number(process.env.NEXT_PUBLIC_WORK_POLL_INTERVAL_MS ?? 10000);
    const interval = window.setInterval(() => {
      void refresh();
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [data.currentRun]);

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
      <aside className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">{data.taskShell.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Status: {data.taskShell.status}</p>
        </div>
        <dl className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-between gap-4">
            <dt>Priority</dt>
            <dd>{data.taskShell.priority}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>Due</dt>
            <dd>{formatDate(data.taskShell.dueAt)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>Schedule</dt>
            <dd>{data.taskShell.scheduleStatus}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>Window</dt>
            <dd>
              {formatDate(data.taskShell.scheduledStartAt)} to {formatDate(data.taskShell.scheduledEndAt)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>Next action</dt>
            <dd>{data.taskShell.blockReason?.actionRequired ?? "Observe timeline"}</dd>
          </div>
        </dl>
        <Link
          href="/schedule"
          className="inline-flex rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
        >
          Open Schedule
        </Link>
      </aside>

      <div className="space-y-4">
        <ExecutionTimeline events={data.timeline} />
        <ConversationPanel entries={data.conversation} />
      </div>

      <RunSidePanel
        currentRun={data.currentRun}
        approvals={data.approvals}
        artifacts={data.artifacts}
        toolCalls={data.toolCalls}
      />
    </div>
  );
}

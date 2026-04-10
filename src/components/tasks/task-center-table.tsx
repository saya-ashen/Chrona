"use client";

import { useMemo } from "react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { useI18n } from "@/i18n/client";

type TaskCenterTableProps = {
  rows: Array<{
    taskId: string;
    title: string;
    persistedStatus: string;
    displayState: string | null;
    latestRunStatus: string | null;
    actionRequired: string | null;
    scheduleStatus: string | null;
    dueAt: Date | null;
    updatedAt: Date;
    workspaceId: string;
  }>;
};

const DEFAULT_COPY = {
  title: "Title",
  status: "Status",
  latestRun: "Latest Run",
  blockReason: "Block Reason",
  schedule: "Schedule",
  due: "Due",
  actions: "Actions",
  empty: "No tasks match this filter.",
  planningHint: "Open task for planning details, or jump straight into work.",
  noRun: "No run",
  openWork: "Open Work",
  startWork: "Start Work",
  openTask: "Open Task",
};

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "-";
}

export function TaskCenterTable({ rows }: TaskCenterTableProps) {
  const { messages } = useI18n();
  const copy = useMemo(
    () => ({
      ...DEFAULT_COPY,
      ...((messages.components?.taskCenterTable as Partial<typeof DEFAULT_COPY> | undefined) ?? {}),
    }),
    [messages],
  );

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{copy.title}</th>
            <th className="px-4 py-3 font-medium">{copy.status}</th>
            <th className="px-4 py-3 font-medium">{copy.latestRun}</th>
            <th className="px-4 py-3 font-medium">{copy.blockReason}</th>
            <th className="px-4 py-3 font-medium">{copy.schedule}</th>
            <th className="px-4 py-3 font-medium">{copy.due}</th>
            <th className="px-4 py-3 font-medium">{copy.actions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                {copy.empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.taskId} className="border-t align-top">
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    <LocalizedLink
                      href={`/workspaces/${row.workspaceId}/tasks/${row.taskId}`}
                      className="font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {row.title}
                    </LocalizedLink>
                    <p className="text-xs text-muted-foreground">{copy.planningHint}</p>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {row.displayState ?? row.persistedStatus}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.latestRunStatus ?? copy.noRun}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.actionRequired ?? "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.scheduleStatus ?? "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(row.dueAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <LocalizedLink
                      href={`/workspaces/${row.workspaceId}/work/${row.taskId}`}
                      className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      {row.latestRunStatus ? copy.openWork : copy.startWork}
                    </LocalizedLink>
                    <LocalizedLink
                      href={`/workspaces/${row.workspaceId}/tasks/${row.taskId}`}
                      className="rounded-md border px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted"
                    >
                      {copy.openTask}
                    </LocalizedLink>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

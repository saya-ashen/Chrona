import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard, SurfaceCardHeader, SurfaceCardTitle } from "@/components/ui/surface-card";
import { TaskContextLinks } from "@/components/ui/task-context-links";

type MemoryConsoleProps = {
  items: Array<{
    id: string;
    content: string;
    sourceType: string;
    scope: string;
    status: string;
    workspaceId: string;
    taskId: string | null;
    taskTitle: string | null;
    runLabel: string | null;
    actions?: ReactNode;
  }>;
};

export function MemoryConsole({ items }: MemoryConsoleProps) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <SurfaceCard key={item.id} className="space-y-4">
          <SurfaceCardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SurfaceCardTitle className="text-base leading-6">{item.content}</SurfaceCardTitle>
              <div className="flex flex-wrap gap-2">
                <StatusBadge>{item.scope}</StatusBadge>
                <StatusBadge tone={item.status === "Active" ? "success" : "neutral"}>{item.status}</StatusBadge>
              </div>
            </div>
          </SurfaceCardHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Source: {item.sourceType}</p>
            <p>Task: {item.taskTitle ?? "-"}</p>
            <p>Run: {item.runLabel ?? "-"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.taskId ? (
              <TaskContextLinks workspaceId={item.workspaceId} taskId={item.taskId} workLabel="Open Workbench" />
            ) : null}
            {item.actions ?? <button type="button" className={buttonVariants({ variant: "outline" })}>Invalidate</button>}
          </div>
        </SurfaceCard>
      ))}
    </div>
  );
}

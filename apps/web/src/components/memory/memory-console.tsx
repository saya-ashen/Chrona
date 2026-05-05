import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard, SurfaceCardHeader, SurfaceCardTitle } from "@/components/ui/surface-card";
import { TaskContextLinks } from "@/components/task/shared/task-context-links";

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
  copy?: Partial<typeof DEFAULT_COPY>;
};

const DEFAULT_COPY = {
  source: "Source",
  task: "Task",
  run: "Run",
  openWorkbench: "Open Workbench",
  invalidate: "Invalidate",
};

export function MemoryConsole({ items, copy: copyProp }: MemoryConsoleProps) {
  const copy = { ...DEFAULT_COPY, ...copyProp };

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
            <p>{copy.source}: {item.sourceType}</p>
            <p>{copy.task}: {item.taskTitle ?? "-"}</p>
            <p>{copy.run}: {item.runLabel ?? "-"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.taskId ? (
              <TaskContextLinks workspaceId={item.workspaceId} taskId={item.taskId} workLabel={copy.openWorkbench} />
            ) : null}
            {item.actions ?? <button type="button" className={buttonVariants({ variant: "outline" })}>{copy.invalidate}</button>}
          </div>
        </SurfaceCard>
      ))}
    </div>
  );
}

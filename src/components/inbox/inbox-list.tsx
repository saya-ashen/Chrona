import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/ui/surface-card";
import { TaskContextLinks } from "@/components/ui/task-context-links";

type InboxListProps = {
  items: Array<{
    id: string;
    kind: "approval" | "input" | "schedule_proposal" | "recovery";
    actionType: string;
    riskLevel: string;
    sourceTaskTitle: string;
    sourceTaskId: string;
    workspaceId: string;
    currentRunLabel: string | null;
    detail?: string | null;
    summary: string;
    consequence: string;
    actions?: ReactNode;
  }>;
  copy?: Partial<typeof DEFAULT_COPY>;
};

const DEFAULT_COPY = {
  risk: "Risk",
  task: "Task",
  run: "Run",
  openWorkContext: "Open Work Context",
  openWorkbench: "Open Workbench",
  approve: "Approve",
  reject: "Reject",
  editAndApprove: "Edit and Approve",
};

export function InboxList({ items, copy: copyProp }: InboxListProps) {
  const copy = { ...DEFAULT_COPY, ...copyProp };

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <SurfaceCard key={item.id} className="space-y-4">
          <SurfaceCardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <SurfaceCardTitle>{item.actionType}</SurfaceCardTitle>
                <SurfaceCardDescription>{item.sourceTaskTitle}</SurfaceCardDescription>
              </div>
              <StatusBadge tone={item.riskLevel.toLowerCase() === "high" ? "critical" : item.riskLevel.toLowerCase() === "medium" ? "warning" : "neutral"}>
                {copy.risk}: {item.riskLevel}
              </StatusBadge>
            </div>
          </SurfaceCardHeader>
          <div className="grid gap-2 text-sm text-muted-foreground">
            {item.detail ? <p>{item.detail}</p> : null}
            <p>{copy.task}: {item.sourceTaskTitle}</p>
            {item.currentRunLabel ? <p>{copy.run}: {item.currentRunLabel}</p> : null}
            <p>{item.summary}</p>
            <p>{item.consequence}</p>
          </div>
          <TaskContextLinks
            workspaceId={item.workspaceId}
            taskId={item.sourceTaskId}
            workLabel={item.kind === "schedule_proposal" ? copy.openWorkContext : copy.openWorkbench}
          />
          <div className="flex flex-wrap gap-2">
            {item.actions ?? (
              <>
                <button
                  type="button"
                  className={buttonVariants({ variant: "default" })}
                >
                  {copy.approve}
                </button>
                <button
                  type="button"
                  className={buttonVariants({ variant: "destructive" })}
                >
                  {copy.reject}
                </button>
                <button
                  type="button"
                  className={buttonVariants({ variant: "outline" })}
                >
                  {copy.editAndApprove}
                </button>
              </>
            )}
          </div>
        </SurfaceCard>
      ))}
    </div>
  );
}

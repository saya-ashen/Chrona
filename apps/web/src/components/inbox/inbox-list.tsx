import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskContextLinks } from "@/components/tasks/shared/task-context-links";

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
  onApprove?: (itemId: string) => void;
  onReject?: (itemId: string) => void;
  onEditAndApprove?: (itemId: string) => void;
};

const DEFAULT_COPY = {
  risk: "Risk",
  task: "Task",
  run: "Run",
  openTask: "Open Task",
  approve: "Approve",
  reject: "Reject",
  editAndApprove: "Edit and Approve",
};

export function InboxList({
  items,
  copy: copyProp,
  onApprove,
  onReject,
  onEditAndApprove,
}: InboxListProps) {
  const copy = { ...DEFAULT_COPY, ...copyProp };

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <Card key={item.id} className="space-y-4">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>{item.actionType}</CardTitle>
                <CardDescription>{item.sourceTaskTitle}</CardDescription>
              </div>
              <Badge variant={item.riskLevel.toLowerCase() === "high" ? "destructive" : item.riskLevel.toLowerCase() === "medium" ? "secondary" : "outline"}>
                {copy.risk}: {item.riskLevel}
              </Badge>
            </div>
          </CardHeader>
          <div className="grid gap-2 text-sm text-muted-foreground">
            {item.detail ? <p>{item.detail}</p> : null}
            <p>{copy.task}: {item.sourceTaskTitle}</p>
            {item.currentRunLabel ? <p>{copy.run}: {item.currentRunLabel}</p> : null}
            <p>{item.summary}</p>
            <p>{item.consequence}</p>
          </div>
          <TaskContextLinks
            taskId={item.sourceTaskId}
          />
          <div className="flex flex-wrap gap-2">
            {item.actions ?? (
              <>
                <Button
                  type="button"
                  variant="default"
                  onClick={() => onApprove?.(item.id)}
                >
                  {copy.approve}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => onReject?.(item.id)}
                >
                  {copy.reject}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onEditAndApprove?.(item.id)}
                >
                  {copy.editAndApprove}
                </Button>
              </>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

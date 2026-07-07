import type { ReactNode } from "react";
import type { ActionCenterItem } from "@chrona/contracts/api";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskContextLinks } from "@/components/tasks/shared/task-context-links";
import { LocalizedLink } from "@/components/i18n/localized-link";

type ActionCenterListProps = {
  items: Array<ActionCenterItem & { actions?: ReactNode }>;
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
  emptyTitle: "You're all caught up",
  emptyDescription: "No items need your attention right now.",
  emptyAction: "View tasks",
};

export function ActionCenterList({
  items,
  copy: copyProp,
  onApprove,
  onReject,
  onEditAndApprove,
}: ActionCenterListProps) {
  const copy = { ...DEFAULT_COPY, ...copyProp };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Bell className="size-6" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">{copy.emptyTitle}</p>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{copy.emptyDescription}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <LocalizedLink href="/tasks">{copy.emptyAction}</LocalizedLink>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <Card key={item.id} className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <CardTitle className="break-words">{item.actionType}</CardTitle>
                <CardDescription className="break-words">{item.sourceTaskTitle}</CardDescription>
              </div>
              <Badge variant={item.riskLevel.toLowerCase() === "high" ? "destructive" : item.riskLevel.toLowerCase() === "medium" ? "secondary" : "outline"}>
                {copy.risk}: {item.riskLevel}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="grid gap-2 rounded-xl bg-muted/30 p-4 text-sm leading-6 text-muted-foreground"
              data-testid="action-center-message"
            >
              {item.detail ? <p className="break-words">{item.detail}</p> : null}
              <p className="break-words">{copy.task}: {item.sourceTaskTitle}</p>
              {item.currentRunLabel ? <p className="break-words">{copy.run}: {item.currentRunLabel}</p> : null}
              <p className="break-words text-foreground">{item.summary}</p>
              <p className="break-words">{item.consequence}</p>
            </div>
            <TaskContextLinks
              taskId={item.sourceTaskId}
            />
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2 pt-0">
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
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

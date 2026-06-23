import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskContextLinks } from "@/components/tasks/shared/task-context-links";
import { Brain } from "lucide-react";

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
  invalidate: "Invalidate",
  emptyTitle: "No active memories yet",
  emptyDescription: "Chrona stores reusable guidance here after task work creates memory records.",
};

export function MemoryConsole({ items, copy: copyProp }: MemoryConsoleProps) {
  const copy = { ...DEFAULT_COPY, ...copyProp };

  if (items.length === 0) {
    return (
      <Card className="border-dashed bg-card/50">
        <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Brain className="size-6" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="text-base font-semibold text-foreground">{copy.emptyTitle}</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">{copy.emptyDescription}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <Card key={item.id} className="space-y-4">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle className="text-base leading-6">{item.content}</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Badge>{item.scope}</Badge>
                <Badge variant={item.status === "Active" ? "secondary" : "outline"}>{item.status}</Badge>
              </div>
            </div>
          </CardHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{copy.source}: {item.sourceType}</p>
            <p>{copy.task}: {item.taskTitle ?? "-"}</p>
            <p>{copy.run}: {item.runLabel ?? "-"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.taskId ? (
              <TaskContextLinks taskId={item.taskId} />
            ) : null}
            {item.actions ?? <Button type="button" variant="outline">{copy.invalidate}</Button>}
          </div>
        </Card>
      ))}
    </div>
  );
}

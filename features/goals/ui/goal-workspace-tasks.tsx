"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useLocale } from "@chrona/i18n";
import { Badge, Button } from "@shared/ui";
import type { GoalCopy, GoalData, GoalTaskData, GoalTaskGroup } from "../model/goal-types";
import { LocalizedLink } from "./localized-link";
import { formatDate } from "./goal-workspace-shared";
import { CriteriaCardContent } from "./goal-workspace-criteria";
import { CreateTaskDialogContent } from "./goal-workspace-create-task";
export function CriteriaCard({ goal, copy }: { goal: GoalData; copy: GoalCopy }) {
  return <CriteriaCardContent goal={goal} copy={copy} />;
}

export function TaskRow({
  task,
  copy,
  goalId,
}: {
  task: GoalTaskData;
  copy: GoalCopy;
  goalId: string;
}) {
  const locale = useLocale();
  const tone =
    task.group === "attention"
      ? "border-l-warning bg-warning/[0.025]"
      : task.group === "active"
        ? "border-l-info bg-info/[0.025]"
        : task.group === "completed"
          ? "border-l-success bg-success/[0.025]"
          : "border-l-muted";
  return (
    <div
      className={`flex min-w-0 flex-col gap-3 border-l-4 py-3 pl-4 pr-2 sm:flex-row sm:items-center sm:justify-between ${tone}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{task.title}</p>
          <Badge
            variant={
              task.group === "attention"
                ? "destructive"
                : task.group === "completed"
                  ? "secondary"
                  : "outline"
            }
          >
            {copy.taskStatus[task.status] ?? task.status}
          </Badge>
          {task.attention ? (
            <Badge variant="destructive">{task.attention}</Badge>
          ) : null}
        </div>
        {task.description ? (
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
            {task.description}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          {formatDate(task.updatedAt, locale)}
        </p>
      </div>
      <Button
        asChild
        size="sm"
        variant={task.group === "attention" ? "default" : "outline"}
      >
        <LocalizedLink href={`/goals/${goalId}/workbench/tasks/${task.id}`}>
          {copy.openTask}
          <ExternalLink className="size-4" />
        </LocalizedLink>
      </Button>
    </div>
  );
}
export function TaskGroupSection({
  group,
  tasks,
  copy,
  defaultOpen,
  goalId,
}: {
  group: GoalTaskGroup;
  tasks: GoalTaskData[];
  copy: GoalCopy;
  defaultOpen: boolean;
  goalId: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (tasks.length === 0) return null;
  return (
    <section className="space-y-3">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-lg py-1 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-semibold">
          {copy.taskGroups[group]}
          <Badge variant="secondary">{tasks.length}</Badge>
        </span>
        {open ? (
          <ChevronUp className="size-4" />
        ) : (
          <ChevronDown className="size-4" />
        )}
      </button>
      {open ? (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} copy={copy} goalId={goalId} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function CreateTaskDialog({
  goal,
  copy,
  kind,
  open,
  onOpenChange,
}: {
  goal: GoalData;
  copy: GoalCopy;
  kind: "task" | "review";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return <CreateTaskDialogContent goal={goal} copy={copy} kind={kind} open={open} onOpenChange={onOpenChange} />;
}

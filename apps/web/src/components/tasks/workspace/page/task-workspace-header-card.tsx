import { useState } from "react";
import { CalendarDays, Ellipsis, Loader2, Pause, Pencil, Play, Sparkles, Square, Trash2 } from "lucide-react";
import { useI18n, useLocale } from "@chrona/i18n/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { TaskActionsMenu, type TaskActionsMenuItem } from "@/components/tasks/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskData, TaskHeaderAction, TaskHeaderView } from "../model/task-workspace-types";

function priorityTone(priority: string) {
  if (priority === "Urgent") return "destructive" as const;
  if (priority === "High") return "secondary" as const;
  return "outline" as const;
}

function statusTone(status: string) {
  if (["Completed", "Done"].includes(status)) return "secondary" as const;
  if (["Running", "Ready", "Queued", "Scheduled"].includes(status))
    return "secondary" as const;
  if (["WaitingForInput", "WaitingForApproval"].includes(status))
    return "secondary" as const;
  if (["Failed", "Blocked"].includes(status)) return "destructive" as const;
  return "outline" as const;
}

function userStatusTone(status: TaskHeaderView["status"]) {
  if (status === "completed") return "secondary" as const;
  if (status === "running") return "secondary" as const;
  if (status === "approval-needed") return "secondary" as const;
  if (status === "blocked") return "destructive" as const;
  return "outline" as const;
}

function shouldShowPersistedTaskStatus(taskStatus: string, primaryStatusLabel: string) {
  if (taskStatus === primaryStatusLabel) {
    return false;
  }

  return !["Draft", "Ready"].includes(taskStatus);
}

function actionIcon(actionId: TaskHeaderAction["id"]) {
  if (actionId === "start") return Play;
  if (actionId === "pause") return Pause;
  if (actionId === "stop") return Square;
  return Ellipsis;
}

function actionVariant(actionId: TaskHeaderAction["id"]) {
  if (actionId === "start") return "default" as const;
  if (actionId === "stop") return "destructive" as const;
  return "secondary" as const;
}

type RecurrenceOccurrenceOption = NonNullable<TaskData["recurrenceOccurrences"]>[number];

function formatOccurrenceWindow(start: string | null, end: string | null, locale: string) {
  if (!start) return null;
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return null;
  const endDate = end ? new Date(end) : null;
  const dateLabel = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", weekday: "short" }).format(startDate);
  const startLabel = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(startDate);
  const endLabel = endDate && !Number.isNaN(endDate.getTime())
    ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(endDate)
    : null;

  return endLabel ? `${dateLabel} ${startLabel}-${endLabel}` : `${dateLabel} ${startLabel}`;
}

function occurrenceValue(occurrence: RecurrenceOccurrenceOption) {
  return occurrence.workBlockId ? `${occurrence.taskId}:${occurrence.workBlockId}` : occurrence.taskId;
}

function formatOccurrenceOption(occurrence: RecurrenceOccurrenceOption, locale: string) {
  return formatOccurrenceWindow(occurrence.scheduledStartAt, occurrence.scheduledEndAt, locale)
    ?? occurrence.title;
}


type TaskWorkspaceHeaderCardProps = {
  task: TaskData;
  header: TaskHeaderView;
  backToScheduleLabel: string;
  workspaceStateLabel?: string;
  workspaceStateGuidance?: string;
  planAction?: {
    label: string;
    placement: "primary" | "menu";
    isLoading?: boolean;
    disabled?: boolean;
    onClick: () => void;
  };
  onAction: (action: TaskHeaderAction) => void | Promise<void>;
  onSelectOccurrence: (occurrence: RecurrenceOccurrenceOption) => void;
  onEdit: () => void;
  showDeleteConfirm: boolean;
  isDeleting: boolean;
  onStartDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onDelete: () => void;
};

export function TaskWorkspaceHeaderCard({
  task,
  header,
  backToScheduleLabel,
  workspaceStateLabel,
  workspaceStateGuidance,
  planAction,
  onAction,
  onSelectOccurrence,
  onEdit,
  showDeleteConfirm,
  isDeleting,
  onStartDeleteConfirm,
  onCancelDeleteConfirm,
  onDelete,
}: TaskWorkspaceHeaderCardProps) {
  const { messages } = useI18n();
  const locale = useLocale();
  const copy = messages.components?.taskWorkspace ?? {};
  const occurrenceWindow = formatOccurrenceWindow(task.scheduledStartAt, task.scheduledEndAt, locale);
  const [pendingActionId, setPendingActionId] = useState<TaskHeaderAction["id"] | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const visibleActions = header.actions.filter((action) => action.id !== "more");
  const recurrenceOccurrences = task.recurrenceOccurrences ?? [];
  const currentOccurrence = recurrenceOccurrences.find((occurrence) => occurrence.isCurrent) ?? null;
  const showOccurrenceSelector = recurrenceOccurrences.length > 1;
  const primaryStatusLabel = header.primaryStateLabel
    ?? (header.status === "approval-needed"
      ? copy.approvalNeeded
      : header.status.charAt(0).toUpperCase() + header.status.slice(1));
  const showTaskStatus = shouldShowPersistedTaskStatus(task.status, primaryStatusLabel);
  const menuItems: TaskActionsMenuItem[] = [
    ...(header.canEditTitle
      ? [{
          id: "edit",
          label: copy.edit ?? "Edit",
          icon: Pencil,
          onSelect: onEdit,
        }]
      : []),
    {
      id: "schedule",
      label: backToScheduleLabel,
      icon: Ellipsis,
      href: "/schedule",
    },
    ...(planAction?.placement === "menu"
      ? [{
          id: "plan",
          label: planAction.label,
          icon: planAction.isLoading ? Loader2 : Sparkles,
          disabled: planAction.disabled || planAction.isLoading,
          onSelect: planAction.onClick,
        }]
      : []),
    {
      id: "delete",
      label: copy.deleteTask ?? "Delete Task",
      icon: Trash2,
      destructive: true,
      onSelect: onStartDeleteConfirm,
    },
  ];

  const handleAction = async (action: TaskHeaderAction) => {
    if (action.disabled || pendingActionId) return;
    setPendingActionId(action.id);
    setActionStatus(null);
    try {
      await onAction(action);
      setActionStatus(`${action.label} ${copy.requestSentSuffix ?? "request sent."}`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : `${copy.actionFailedPrefix ?? "Failed to"} ${action.label.toLowerCase()}.`);
    } finally {
      setPendingActionId(null);
    }
  };

  return (
    <Card
      className="relative z-30 min-w-0 overflow-visible rounded-[0.9rem] border-border/70 bg-card/90 p-1 shadow-sm backdrop-blur"
     
     
    >
      <CardHeader className="flex flex-col gap-1.5 px-2.5 py-1.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {workspaceStateLabel ? (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-foreground">
                {workspaceStateLabel}
              </span>
            ) : null}
            <h1 className="min-w-0 break-words text-base font-semibold leading-tight tracking-tight text-foreground lg:max-w-[42vw]">
              {header.title}
            </h1>
            <Badge variant={userStatusTone(header.status)}>
              {primaryStatusLabel}
            </Badge>
            {showTaskStatus ? <Badge variant={statusTone(task.status)}>{task.status}</Badge> : null}
            <Badge variant={priorityTone(task.priority)}>
              {task.priority}
            </Badge>
            {showOccurrenceSelector && currentOccurrence ? (
              <Select
                value={occurrenceValue(currentOccurrence)}
                onValueChange={(value) => {
                  const selected = recurrenceOccurrences.find((occurrence) => occurrenceValue(occurrence) === value);
                  if (selected) onSelectOccurrence(selected);
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="h-6 min-w-[11rem] rounded-full border-border/70 bg-background/70 px-2 py-0 text-xs"
                  aria-label={copy.occurrenceSelectorLabel ?? "Select occurrence"}
                >
                  <CalendarDays className="size-3 text-muted-foreground" />
                  <span className="font-medium">{copy.occurrenceWindowLabel ?? "Occurrence"}</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {recurrenceOccurrences.map((occurrence) => (
                    <SelectItem key={occurrenceValue(occurrence)} value={occurrenceValue(occurrence)}>
                      {formatOccurrenceOption(occurrence, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : occurrenceWindow ? (
              <Badge
                variant="outline"
                className="gap-1"
                title={copy.occurrenceFallbackLabel ?? "Scheduled window"}
              >
                <CalendarDays className="size-3" />
                <span className="font-medium">{copy.occurrenceWindowLabel ?? "Occurrence"}</span>
                {occurrenceWindow}
              </Badge>
            ) : null}
            {task.sourceManaged ? (
              <Badge
                variant="outline"
                className="gap-1"
                title={(copy.externalSourceTitle ?? "Synced from {source}. Title and time are managed by the calendar source.").replace("{source}", task.sourceManaged.sourceName)}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: task.sourceManaged.sourceColor }}
                />
                <CalendarDays className="size-3" />
                {task.sourceManaged.sourceName}
              </Badge>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              {header.totalSteps} {copy.stepsUnit ?? "steps"} · {header.completedSteps} {copy.acceptedUnit ?? "accepted"} · {header.progressPercent}%
              {header.primaryActionLabel ? ` · ${header.primaryActionLabel}` : ""}
            </span>
            {workspaceStateGuidance ? (
              <span className="min-w-0 truncate lg:max-w-[44vw]">
              {workspaceStateGuidance}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center justify-start gap-1 sm:w-auto lg:justify-end">
          {planAction?.placement === "primary" ? (
            <Button
              type="button"
              disabled={planAction.disabled || planAction.isLoading}
              onClick={planAction.onClick}
              variant="default"
              size="sm"
              className="min-w-28 rounded-xl"
            >
              {planAction.isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {planAction.label}
            </Button>
          ) : null}
          {visibleActions.map((action) => {
            const Icon = actionIcon(action.id);
            const isPending = pendingActionId === action.id;
            return (
              <Button
                key={action.id}
                type="button"
                disabled={action.disabled || Boolean(pendingActionId)}
                title={action.disabledReason}
                onClick={() => void handleAction(action)}
                variant={actionVariant(action.id)}
                size="sm"
                className={action.id === "start" ? "min-w-24 rounded-xl" : "rounded-xl"}
              >
                <Icon className={isPending ? "size-3.5 animate-pulse" : "size-3.5"} />
                {isPending ? `${action.label}...` : action.label}
              </Button>
            );
          })}
          <TaskActionsMenu label={copy.moreActions ?? "More task actions"} items={menuItems} />
        </div>
      </CardHeader>

      {actionStatus ? (
        <p className="mt-1 px-2 text-xs text-muted-foreground" role="status">
          {actionStatus}
        </p>
      ) : null}

      <Dialog
        open={showDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) onCancelDeleteConfirm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.deleteConfirmTitlePrefix ?? "Delete"} &ldquo;{task.title}&rdquo;{copy.deleteConfirmTitleSuffix ?? "?"}</DialogTitle>
            <DialogDescription>
              {copy.deleteConfirmDescription ?? "This will permanently delete the task and cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              onClick={onCancelDeleteConfirm}
              variant="outline"
              disabled={isDeleting}
            >
              {copy.cancel ?? "Cancel"}
            </Button>
            <Button
              type="button"
              onClick={onDelete}
              variant="destructive"
              disabled={isDeleting}
            >
              {isDeleting ? (copy.deleting ?? "Deleting...") : (copy.deleteTaskConfirm ?? "Delete task")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

import { useEffect, useRef, useState } from "react";
import { Ellipsis, Loader2, Pause, Pencil, Play, Sparkles, Square, Trash2 } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard, SurfaceCardHeader } from "@/components/ui/surface-card";
import type { TaskData, TaskHeaderAction, TaskHeaderView } from "../model/task-workspace-types";

function priorityTone(priority: string) {
  if (priority === "Urgent") return "critical" as const;
  if (priority === "High") return "warning" as const;
  return "neutral" as const;
}

function statusTone(status: string) {
  if (["Completed", "Done"].includes(status)) return "success" as const;
  if (["Running", "Ready", "Queued", "Scheduled"].includes(status))
    return "info" as const;
  if (["WaitingForInput", "WaitingForApproval"].includes(status))
    return "warning" as const;
  if (["Failed", "Blocked"].includes(status)) return "critical" as const;
  return "neutral" as const;
}

function userStatusTone(status: TaskHeaderView["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "running") return "info" as const;
  if (status === "approval-needed") return "warning" as const;
  if (status === "blocked") return "critical" as const;
  return "neutral" as const;
}

function userStatusLabel(status: TaskHeaderView["status"]) {
  if (status === "approval-needed") return "Approval needed";
  return status.charAt(0).toUpperCase() + status.slice(1);
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
  onEdit,
  showDeleteConfirm,
  isDeleting,
  onStartDeleteConfirm,
  onCancelDeleteConfirm,
  onDelete,
}: TaskWorkspaceHeaderCardProps) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<TaskHeaderAction["id"] | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const visibleActions = header.actions.filter((action) => action.id !== "more");
  const primaryStatusLabel = header.primaryStateLabel ?? userStatusLabel(header.status);
  const showTaskStatus = task.status !== primaryStatusLabel;

  const handleAction = async (action: TaskHeaderAction) => {
    if (action.disabled || pendingActionId) return;
    setPendingActionId(action.id);
    setActionStatus(null);
    try {
      await onAction(action);
      setActionStatus(`${action.label} request sent.`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : `Failed to ${action.label.toLowerCase()}.`);
    } finally {
      setPendingActionId(null);
    }
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(e.target as Node)
      ) {
        setShowMoreMenu(false);
      }
    }

    if (showMoreMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMoreMenu]);

  return (
    <SurfaceCard
      className="relative z-30 min-w-0 overflow-visible rounded-[0.9rem] border-slate-200/80 bg-white/88 p-1 shadow-sm backdrop-blur"
      variant="inset"
      padding="none"
    >
      <SurfaceCardHeader className="flex flex-col gap-1.5 px-2.5 py-1.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {workspaceStateLabel ? (
              <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                {workspaceStateLabel}
              </span>
            ) : null}
            <h1 className="min-w-0 break-words text-base font-semibold leading-tight tracking-tight text-slate-950 lg:max-w-[42vw]">
              {header.title}
            </h1>
            <StatusBadge tone={userStatusTone(header.status)}>
              {primaryStatusLabel}
            </StatusBadge>
            {showTaskStatus ? <StatusBadge tone={statusTone(task.status)}>{task.status}</StatusBadge> : null}
            <StatusBadge tone={priorityTone(task.priority)}>
              {task.priority}
            </StatusBadge>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            {task.runnabilityState ? (
              <StatusBadge tone={task.isRunnable ? "success" : "warning"}>
                {task.runnabilitySummary}
              </StatusBadge>
            ) : null}
            <span>
              {header.totalSteps} steps · {header.completedSteps} accepted · {header.progressPercent}%
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
            <button
              type="button"
              disabled={planAction.disabled || planAction.isLoading}
              onClick={planAction.onClick}
              className={buttonVariants({
                variant: "default",
                size: "sm",
                className: "min-w-28 rounded-xl",
              })}
            >
              {planAction.isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {planAction.label}
            </button>
          ) : null}
          {visibleActions.map((action) => {
            const Icon = actionIcon(action.id);
            const isPending = pendingActionId === action.id;
            return (
              <button
                key={action.id}
                type="button"
                disabled={action.disabled || Boolean(pendingActionId)}
                title={action.disabledReason}
                onClick={() => void handleAction(action)}
                className={buttonVariants({
                  variant: actionVariant(action.id),
                  size: "sm",
                  className: action.id === "start" ? "min-w-24 rounded-xl" : "rounded-xl",
                })}
              >
                <Icon className={isPending ? "size-3.5 animate-pulse" : "size-3.5"} />
                {isPending ? `${action.label}...` : action.label}
              </button>
            );
          })}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setShowMoreMenu((current) => !current)}
              className={buttonVariants({
                variant: "ghost",
                className: "size-7 rounded-lg",
              })}
            >
              <Ellipsis className="size-3.5" />
            </button>
            {showMoreMenu ? (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-border/60 bg-white p-1 shadow-[0_14px_36px_rgba(15,23,42,0.12)]">
                {header.canEditTitle ? (
                  <button
                    type="button"
                    onClick={() => {
                      onEdit();
                      setShowMoreMenu(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-foreground hover:bg-muted"
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </button>
                ) : null}
                <LocalizedLink
                  href="/schedule"
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-foreground hover:bg-muted"
                >
                  <Ellipsis className="size-3.5" />
                  {backToScheduleLabel}
                </LocalizedLink>
                {planAction?.placement === "menu" ? (
                  <button
                    type="button"
                    disabled={planAction.disabled || planAction.isLoading}
                    onClick={() => {
                      planAction.onClick();
                      setShowMoreMenu(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {planAction.isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    {planAction.label}
                  </button>
                ) : null}
                {!showDeleteConfirm ? (
                  <button
                    type="button"
                    onClick={() => {
                      onStartDeleteConfirm();
                      setShowMoreMenu(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="size-4" />
                    Delete Task
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </SurfaceCardHeader>

      {actionStatus ? (
        <p className="mt-1 px-2 text-xs text-muted-foreground" role="status">
          {actionStatus}
        </p>
      ) : null}

      {showDeleteConfirm ? (
        <div className="mt-1 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <p className="font-medium">Delete &ldquo;{task.title}&rdquo;?</p>
              <p className="text-xs text-destructive/80">
                This cannot be undone.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onDelete}
                className={buttonVariants({
                  variant: "destructive",
                  size: "sm",
                })}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={onCancelDeleteConfirm}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SurfaceCard>
  );
}

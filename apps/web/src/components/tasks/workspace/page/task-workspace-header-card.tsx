import { useEffect, useRef, useState } from "react";
import { Download, Ellipsis, Loader2, Pause, Pencil, Play, Sparkles, Trash2 } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard, SurfaceCardHeader } from "@/components/ui/surface-card";
import type { TaskData, TaskHeaderAction, TaskHeaderView, TaskPlanGenerationStatus } from "../model/task-workspace-types";

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
  if (actionId === "continue") return Play;
  if (actionId === "pause") return Pause;
  if (actionId === "export") return Download;
  return Ellipsis;
}

function actionVariant(actionId: TaskHeaderAction["id"]) {
  return actionId === "continue" ? "default" : "outline";
}

type TaskWorkspaceHeaderCardProps = {
  task: TaskData;
  header: TaskHeaderView;
  backToScheduleLabel: string;
  planGenerationStatus: TaskPlanGenerationStatus;
  hasPlan: boolean;
  onGeneratePlan: () => void;
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
  planGenerationStatus,
  hasPlan,
  onGeneratePlan,
  onEdit,
  showDeleteConfirm,
  isDeleting,
  onStartDeleteConfirm,
  onCancelDeleteConfirm,
  onDelete,
}: TaskWorkspaceHeaderCardProps) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const visibleActions = header.actions.filter((action) => action.id === "continue" || action.id === "pause");
  const overflowActions = header.actions.filter((action) => action.id !== "continue" && action.id !== "pause" && action.id !== "more");

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
      className="relative z-30 overflow-visible rounded-[0.85rem] border-border/40 bg-background/70 p-1.5 shadow-none backdrop-blur-[2px]"
      variant="inset"
      padding="none"
    >
      <SurfaceCardHeader className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="min-w-0 truncate text-base font-semibold tracking-tight lg:max-w-[34vw]">
            {header.title}
          </h1>
          <div className="flex flex-wrap items-center gap-1">
            <StatusBadge tone={userStatusTone(header.status)}>
              {userStatusLabel(header.status)}
            </StatusBadge>
            <StatusBadge tone={statusTone(task.status)}>{task.status}</StatusBadge>
            <StatusBadge tone={priorityTone(task.priority)}>
              {task.priority}
            </StatusBadge>
            {task.runnabilityState ? (
              <StatusBadge tone={task.isRunnable ? "success" : "warning"}>
                {task.runnabilitySummary}
              </StatusBadge>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">
            {header.totalSteps} steps · {header.completedSteps} accepted · {header.progressPercent}%
          </span>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-start gap-1 lg:justify-end">
          {visibleActions.map((action) => {
            const Icon = actionIcon(action.id);
            return (
              <button
                key={action.id}
                type="button"
                disabled={action.disabled}
                title={action.disabledReason}
                className={buttonVariants({
                  variant: actionVariant(action.id),
                  size: "sm",
                  className: "h-7 rounded-lg px-2 text-xs",
                })}
              >
                <Icon className="size-3.5" />
                {action.label}
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
                <button
                  type="button"
                  onClick={() => {
                    onGeneratePlan();
                    setShowMoreMenu(false);
                  }}
                  disabled={planGenerationStatus === "generating"}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {planGenerationStatus === "generating" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {planGenerationStatus === "generating" ? "Generating..." : hasPlan ? "Regenerate plan" : "Generate plan"}
                </button>
                {overflowActions.map((action) => {
                  const Icon = actionIcon(action.id);
                  return (
                    <button
                      key={action.id}
                      type="button"
                      disabled={action.disabled}
                      title={action.disabledReason}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Icon className="size-3.5" />
                      {action.label}
                    </button>
                  );
                })}
                <LocalizedLink
                  href="/schedule"
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-foreground hover:bg-muted"
                >
                  <Ellipsis className="size-3.5" />
                  {backToScheduleLabel}
                </LocalizedLink>
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

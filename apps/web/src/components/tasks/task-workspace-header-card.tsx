import { useEffect, useRef, useState } from "react";
import { Ellipsis, Trash2 } from "lucide-react";
import { LocalizedLink } from "@/components/i18n/localized-link";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SurfaceCard, SurfaceCardHeader } from "@/components/ui/surface-card";
import type { ProgressSummary, TaskData } from "./task-workspace-types";

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

type TaskWorkspaceHeaderCardProps = {
  task: TaskData;
  progress: ProgressSummary;
  currentNodeTitle?: string | null;
  nextAction?: string | null;
  backToScheduleLabel: string;
  showDeleteConfirm: boolean;
  isDeleting: boolean;
  onStartDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onDelete: () => void;
  children?: React.ReactNode;
};

export function TaskWorkspaceHeaderCard({
  task,
  progress,
  currentNodeTitle,
  nextAction,
  backToScheduleLabel,
  showDeleteConfirm,
  isDeleting,
  onStartDeleteConfirm,
  onCancelDeleteConfirm,
  onDelete,
  children,
}: TaskWorkspaceHeaderCardProps) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

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
      className="relative z-30 space-y-3 overflow-visible rounded-[1.45rem] border-border/50 bg-background/55 shadow-none backdrop-blur-[2px]"
      variant="inset"
      padding="sm"
    >
      <SurfaceCardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-3xl space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-balance xl:text-base">
            {task.title}
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={statusTone(task.status)}>
              {task.status}
            </StatusBadge>
            <StatusBadge tone={priorityTone(task.priority)}>
              {task.priority}
            </StatusBadge>
            {task.runnabilityState ? (
              <StatusBadge tone={task.isRunnable ? "success" : "warning"}>
                {task.runnabilitySummary}
              </StatusBadge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{progress.label}</span>
            <span>{progress.percentComplete}% complete</span>
            <span>{task.scheduleStatus}</span>
          </div>
          {currentNodeTitle || nextAction ? (
            <div className="grid gap-2 rounded-2xl border border-border/45 bg-muted/25 px-3 py-2 text-xs text-muted-foreground sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <div className="min-w-0">
                <p className="uppercase tracking-[0.14em]">Current node</p>
                <p className="truncate font-medium text-foreground">{currentNodeTitle ?? "No active node"}</p>
              </div>
              <div className="min-w-0">
                <p className="uppercase tracking-[0.14em]">Next action</p>
                <p className="truncate font-medium text-foreground">{nextAction ?? "Select a plan node to inspect next steps"}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <LocalizedLink
            href="/schedule"
            className={buttonVariants({
              variant: "outline",
              className: "h-9 rounded-xl px-3",
            })}
          >
            {backToScheduleLabel}
          </LocalizedLink>
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setShowMoreMenu((current) => !current)}
              className={buttonVariants({
                variant: "ghost",
                className: "size-9 rounded-xl",
              })}
            >
              <Ellipsis className="size-4" />
            </button>
            {showMoreMenu ? (
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-2xl border border-border/70 bg-white p-1.5 shadow-[0_14px_36px_rgba(15,23,42,0.12)]">
                {!showDeleteConfirm ? (
                  <button
                    type="button"
                    onClick={() => {
                      onStartDeleteConfirm();
                      setShowMoreMenu(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-50"
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
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="font-medium">Delete &ldquo;{task.title}&rdquo;?</p>
              <p className="text-xs text-destructive/80">
                This cannot be undone.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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

      {children}
    </SurfaceCard>
  );
}

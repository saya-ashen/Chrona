import { useMemo, useState } from "react";
import { useI18n } from "@chrona/i18n/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UI_ACTION, type UiDocument } from "@chrona/ui-protocol";
import { SpecRenderer } from "../catalog/spec-renderer";
import type { TaskData, TaskHeaderAction } from "../model/task-workspace-types";

type HeaderActionId = TaskHeaderAction["id"];

type TaskWorkspaceHeaderCardProps = {
  task: Pick<TaskData, "title">;
  spec: UiDocument;
  onAction: (action: TaskHeaderAction) => void | Promise<void>;
  onAcceptPlan: () => void | Promise<void>;
  onGeneratePlan: () => void | Promise<void>;
  onEdit: () => void;
  showDeleteConfirm: boolean;
  isDeleting: boolean;
  onStartDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onDelete: () => void;
};

const EXECUTION_ACTION_LABELS: Record<HeaderActionId, string> = {
  start: "Start",
  pause: "Pause",
  stop: "Stop",
  more: "More",
};

function findActionLabel(spec: UiDocument, actionId: HeaderActionId) {
  const key = `action:${actionId}`;
  const label = spec.elements[key]?.props?.label;
  return typeof label === "string" ? label.replace(/\.\.\.$/, "") : EXECUTION_ACTION_LABELS[actionId];
}

export function TaskWorkspaceHeaderCard({
  task,
  spec,
  onAction,
  onAcceptPlan,
  onGeneratePlan,
  onEdit,
  showDeleteConfirm,
  isDeleting,
  onStartDeleteConfirm,
  onCancelDeleteConfirm,
  onDelete,
}: TaskWorkspaceHeaderCardProps) {
  const { messages } = useI18n();
  const copy = messages.components?.taskWorkspace ?? {};
  const [pendingActionId, setPendingActionId] = useState<HeaderActionId | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const handleExecutionAction = async (actionId: HeaderActionId) => {
    if (actionId === "more" || pendingActionId) return;
    const label = findActionLabel(spec, actionId);
    setPendingActionId(actionId);
    setActionStatus(null);
    try {
      await onAction({ id: actionId, label });
      setActionStatus(`${label} ${copy.requestSentSuffix ?? "request sent."}`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : `${copy.actionFailedPrefix ?? "Failed to"} ${label.toLowerCase()}.`);
    } finally {
      setPendingActionId(null);
    }
  };

  const handlers = useMemo(() => ({
    "edit-task": () => {
      onEdit();
    },
    "delete-task": () => {
      onStartDeleteConfirm();
    },
    [UI_ACTION.acceptPlan]: async () => {
      await Promise.resolve(onAcceptPlan());
    },
    [UI_ACTION.regeneratePlan]: async () => {
      await Promise.resolve(onGeneratePlan());
    },
    [UI_ACTION.dispatchExecution]: async (params: Record<string, unknown>) => {
      const actionId = params.actionId;
      if (actionId === "start" || actionId === "pause" || actionId === "stop" || actionId === "more") {
        await handleExecutionAction(actionId);
      }
    },
  }), [onAcceptPlan, onEdit, onGeneratePlan, onStartDeleteConfirm, pendingActionId, spec]);

  return (
    <>
      <SpecRenderer spec={spec} handlers={handlers} />
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
              {isDeleting ? (copy.deleting ?? "Deleting...") : (copy.deleteTask ?? "Delete Task")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

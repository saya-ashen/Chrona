import { useMemo, useRef, useState } from "react";
import { type StateStore } from "@json-render/react";
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
import { SpecRenderer } from "@/components/tasks/workspace/catalog/spec-renderer";
import type { TaskData, TaskHeaderAction } from "..";

type HeaderActionId = TaskHeaderAction["id"];

type TaskWorkspaceHeaderCardProps = {
  task: Pick<TaskData, "title">;
  spec: UiDocument;
  store: StateStore;
  onAction: (action: TaskHeaderAction) => void | Promise<void>;
  onAcceptPlan: () => void | Promise<void>;
  onGeneratePlan: () => void | Promise<void>;
  onEdit: () => void;
  showDeleteConfirm: boolean;
  isDeleting: boolean;
  onStartDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onDelete: () => void;
  onRecoveryRetry: () => void | Promise<void>;
  onRecoveryEditInstruction: () => void | Promise<void>;
  onRecoveryCancel: () => void;
};


function findActionLabel(spec: UiDocument, actionId: HeaderActionId) {
  const key = `action:${actionId}`;
  const label = (spec.elements[key]?.props as { label?: string } | undefined)?.label;
  return label ?? actionId;
}

export function TaskWorkspaceHeaderCard({
  task,
  spec,
  store,
  onAction,
  onAcceptPlan,
  onGeneratePlan,
  onEdit,
  showDeleteConfirm,
  isDeleting,
  onStartDeleteConfirm,
  onCancelDeleteConfirm,
  onDelete,
  onRecoveryRetry,
  onRecoveryEditInstruction,
  onRecoveryCancel,
}: TaskWorkspaceHeaderCardProps) {
  const { messages } = useI18n();
  const copy = messages.components.taskWorkspace;
  const [pendingActionId, setPendingActionId] = useState<HeaderActionId | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  // Refs so that the handlers object (passed to ActionProvider which stores it in
  // useState on mount and never re-syncs prop updates) always reads the current
  // values rather than the stale closure from the initial render.
  const ref = useRef({
    onAcceptPlan,
    onGeneratePlan,
    onEdit,
    onStartDeleteConfirm,
    onAction,
    onRecoveryRetry,
    onRecoveryEditInstruction,
    onRecoveryCancel,
    store,
    spec,
    copy,
    pendingActionId,
  });
  ref.current = {
    onAcceptPlan,
    onGeneratePlan,
    onEdit,
    onStartDeleteConfirm,
    onAction,
    onRecoveryRetry,
    onRecoveryEditInstruction,
    onRecoveryCancel,
    store,
    spec,
    copy,
    pendingActionId,
  };

  // Empty deps: stable identity across all re-renders. Reads from ref at call time.
  const handlers = useMemo(() => ({
    "edit-task": () => {
      ref.current.onEdit();
    },
    "delete-task": () => {
      ref.current.onStartDeleteConfirm();
    },
    "header-overflow-action": (params: Record<string, unknown>) => {
      const actionId = params.actionId;
      if (actionId === "edit") {
        ref.current.onEdit();
        ref.current.store.set("/headerOverflowAction", "");
        return;
      }
      if (actionId === "delete") {
        ref.current.onStartDeleteConfirm();
        ref.current.store.set("/headerOverflowAction", "");
      }
    },
    [UI_ACTION.acceptPlan]: async () => {
      await Promise.resolve(ref.current.onAcceptPlan());
    },
    [UI_ACTION.regeneratePlan]: async () => {
      await Promise.resolve(ref.current.onGeneratePlan());
    },
    [UI_ACTION.dispatchExecution]: async (params: Record<string, unknown>) => {
      const actionId = params.actionId;
      if (actionId !== "start" && actionId !== "pause" && actionId !== "stop" && actionId !== "more") return;
      if (actionId === "more" || ref.current.pendingActionId) return;
      const { spec: currentSpec, copy: currentCopy, onAction: currentOnAction } = ref.current;
      const label = findActionLabel(currentSpec, actionId);
      setPendingActionId(actionId);
      setActionStatus(null);
      try {
        await currentOnAction({ id: actionId, label });
        setActionStatus(`${label} ${currentCopy.requestSentSuffix}`);
      } catch (error) {
        setActionStatus(error instanceof Error ? error.message : `${currentCopy.actionFailedPrefix} ${label.toLowerCase()}.`);
      } finally {
        setPendingActionId(null);
      }
    },
    [UI_ACTION.recoveryRetry]: async () => {
      await Promise.resolve(ref.current.onRecoveryRetry());
    },
    [UI_ACTION.recoveryEditInstruction]: async () => {
      await Promise.resolve(ref.current.onRecoveryEditInstruction());
    },
    [UI_ACTION.recoveryCancel]: () => {
      ref.current.onRecoveryCancel();
    },
  }), []);

  return (
    <>
      <SpecRenderer spec={spec} handlers={handlers} store={store} />
      <p className="sr-only" role="status" aria-live="polite">
        {actionStatus ?? ""}
      </p>
      <Dialog
        open={showDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) onCancelDeleteConfirm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.deleteConfirmTitlePrefix} &ldquo;{task.title}&rdquo;{copy.deleteConfirmTitleSuffix}</DialogTitle>
            <DialogDescription>
              {copy.deleteConfirmDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              onClick={onCancelDeleteConfirm}
              variant="outline"
              disabled={isDeleting}
            >
              {copy.cancel}
            </Button>
            <Button
              type="button"
              onClick={onDelete}
              variant="destructive"
              disabled={isDeleting}
            >
              {isDeleting ? copy.deleting : copy.deleteTask}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

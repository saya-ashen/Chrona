import { useMemo, useRef, useState } from "react";
import { type StateStore } from "@json-render/react";
import { useI18n } from "@chrona/i18n";
import { ArrowLeft, Target } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/ui";
import { UI_ACTION, type UiDocument } from "@chrona/ui-protocol";
import { SpecRenderer } from "./catalog/spec-renderer";
import { LocalizedLink } from "./localized-link";
import type { TaskData, TaskHeaderAction } from "../model/task-workspace-types";

function hideHeaderActions(spec: UiDocument, input: { generatePlan?: boolean; acceptPlan?: boolean }): UiDocument {
  const generateAction = spec.elements["action:generate-plan"];
  const acceptAction = spec.elements["action:accept-plan"];
  if ((!input.generatePlan || !generateAction) && (!input.acceptPlan || !acceptAction)) return spec;
  return {
    ...spec,
    elements: {
      ...spec.elements,
      ...(input.generatePlan && generateAction ? { "action:generate-plan": { ...generateAction, visible: false } } : {}),
      ...(input.acceptPlan && acceptAction ? { "action:accept-plan": { ...acceptAction, visible: false } } : {}),
    },
  };
}

type HeaderActionId = TaskHeaderAction["id"];

type TaskWorkspaceHeaderCardProps = {
  task: Pick<TaskData, "title" | "goal">;
  spec: UiDocument;
  store: StateStore;
  onAction: (action: TaskHeaderAction) => void | Promise<void>;
  hideGeneratePlan?: boolean;
  hideAcceptPlan?: boolean;
  onAcceptPlan: () => void | Promise<void>;
  onGeneratePlan: () => void | Promise<void>;
  onStopPlanGeneration: () => void | Promise<void>;
  onRestartPlan: () => void | Promise<void>;
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
  hideGeneratePlan,
  hideAcceptPlan,
  onAcceptPlan,
  onGeneratePlan,
  onStopPlanGeneration,
  onRestartPlan,
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
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);

  // Refs so that the handlers object (passed to ActionProvider which stores it in
  // useState on mount and never re-syncs prop updates) always reads the current
  // values rather than the stale closure from the initial render.
  const ref = useRef({
    onAcceptPlan,
    onGeneratePlan,
    onStopPlanGeneration,
    onRestartPlan,
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
    onStopPlanGeneration,
    onRestartPlan,
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
      if (actionId === "restart") {
        ref.current.store.set("/headerOverflowAction", "");
        setRestartConfirmOpen(true);
        return;
      }
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
    [UI_ACTION.generatePlan]: async () => {
      await Promise.resolve(ref.current.onGeneratePlan());
    },
    [UI_ACTION.stopPlanGeneration]: async () => {
      await Promise.resolve(ref.current.onStopPlanGeneration());
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
      <header className="relative z-30 min-w-0 overflow-hidden border-y border-panel-border bg-muted/70 px-4 py-3 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary [&_h1]:w-full [&_h1]:min-w-0 [&_h1]:break-words [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight sm:px-5 sm:py-3.5 sm:[&_h1]:text-2xl">
        <nav aria-label={task.goal ? messages.components.taskWorkspace.owningGoal : messages.components.taskWorkspace.backToTasks} className="mb-0.5">
          <Button asChild variant="ghost" size="sm" className="-ml-2 h-7 max-w-full justify-start px-2 text-xs text-muted-foreground hover:text-foreground">
            {task.goal ? (
              <LocalizedLink
                href={`/goals/${task.goal.id}?section=work`}
                aria-label={`${messages.pages.goals.openGoal}: ${task.goal.title}`}
              >
                <Target className="size-4 shrink-0" aria-hidden />
                <span className="shrink-0">{messages.components.taskWorkspace.owningGoal}</span>
                <span aria-hidden className="text-border">/</span>
                <span className="truncate font-medium text-foreground/80">{task.goal.title}</span>
              </LocalizedLink>
            ) : (
              <LocalizedLink href="/tasks">
                <ArrowLeft className="size-4 shrink-0" aria-hidden />
                {messages.components.taskWorkspace.backToTasks}
              </LocalizedLink>
            )}
          </Button>
        </nav>
        <SpecRenderer spec={hideHeaderActions(spec, { generatePlan: hideGeneratePlan, acceptPlan: hideAcceptPlan })} handlers={handlers} store={store} />
      </header>
      <p className="sr-only" role="status" aria-live="polite">
        {actionStatus ?? ""}
      </p>
      <Dialog open={restartConfirmOpen} onOpenChange={setRestartConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy.runPlanFromBeginning ?? "Run plan from beginning"}</DialogTitle>
            <DialogDescription>
              {copy.runPlanFromBeginningDescription ?? "Keep the accepted plan, reset execution progress, and start at its first step."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border bg-muted/35 p-3 text-sm text-muted-foreground">
            <p>{copy.recoveryKeepsPlan ?? "Keeps the task, accepted plan, history, and artifacts."}</p>
            <p className="mt-2 font-medium text-warning-foreground">
              {copy.recoverySideEffectWarning ?? "Completed steps may already have changed external systems. Running again can repeat those actions."}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRestartConfirmOpen(false)}>
              {copy.cancel ?? "Cancel"}
            </Button>
            <Button
              type="button"
              onClick={async () => {
                await Promise.resolve(ref.current.onRestartPlan());
                setRestartConfirmOpen(false);
              }}
            >
              {copy.runPlanFromBeginning ?? "Run plan from beginning"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

import type { AssistantQuickAction, AssistantQuickActionId, AssistantPreviewSurface } from "@chrona/contracts";

const previewSurfaceByAction: Partial<Record<AssistantQuickActionId, AssistantPreviewSurface>> = {
  "smart-schedule": "schedule.timeline",
  "handle-conflict": "schedule.timeline",
  "modify-plan": "task.config",
  "retry-node": "task.graph",
  "add-step": "task.graph",
  "review-result": "workbench.result",
};

export function getPreviewSurfaceForAction(actionId: AssistantQuickActionId) {
  return previewSurfaceByAction[actionId] ?? null;
}

export function assistantActionRequiresPreview(actionId: AssistantQuickActionId) {
  return getPreviewSurfaceForAction(actionId) !== null;
}

export function normalizeAssistantAction(action: Omit<AssistantQuickAction, "previewRequired"> & Partial<Pick<AssistantQuickAction, "previewRequired">>): AssistantQuickAction {
  const previewSurface = action.previewSurface ?? getPreviewSurfaceForAction(action.id) ?? undefined;
  return {
    ...action,
    kind: previewSurface ? "proposal" : action.kind,
    previewRequired: action.previewRequired ?? Boolean(previewSurface),
    previewSurface,
  };
}

export function isAssistantActionRunnable(action: AssistantQuickAction) {
  return action.enabled && !action.disabledReason;
}

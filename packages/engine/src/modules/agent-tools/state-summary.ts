export function summarizeUnknownState(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;
  const task = record.task && typeof record.task === "object"
    ? record.task as Record<string, unknown>
    : record;
  const savedPlan = record.savedPlan && typeof record.savedPlan === "object"
    ? record.savedPlan as Record<string, unknown>
    : null;
  const result = record.result && typeof record.result === "object"
    ? record.result as Record<string, unknown>
    : null;

  return Object.fromEntries(
    Object.entries({
      taskStatus: task.status,
      taskTitle: task.title,
      taskPriority: task.priority,
      planId: savedPlan?.id ?? savedPlan?.planId ?? record.planId,
      planRevision: savedPlan?.revision ?? record.revision,
      planStatus: savedPlan?.status ?? record.aiPlanGenerationStatus,
      scheduleStatus: record.scheduleStatus ?? task.scheduleStatus,
      scheduledStartAt: task.scheduledStartAt ?? record.scheduledStartAt,
      scheduledEndAt: task.scheduledEndAt ?? record.scheduledEndAt,
      executionStatus: result?.status ?? record.status,
      executionSessionId: result?.sessionId ?? record.sessionId,
    }).filter(([, entry]) => entry !== undefined),
  );
}

export function affectedFrom(input: {
  workspaceId?: string;
  taskId?: string;
  planId?: string;
  executionSessionId?: string;
}) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => Boolean(value)),
  );
}

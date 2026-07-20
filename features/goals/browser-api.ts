import { apiJson } from "@shared/http";
import type { PromoteTaskToGoalRequest } from "@chrona/contracts";
import type { GoalData } from "./model/goal-types";

export async function runGoalAction(
  goalId: string,
  action: "pause" | "resume" | "stop" | "review" | "achieve",
  confirmation?: string,
) {
  return apiJson<GoalData>(`/api/goals/${encodeURIComponent(goalId)}/actions`, {
    method: "POST",
    body: JSON.stringify(action === "achieve" ? { action, confirmation } : { action }),
  });
}
export async function promoteTaskToGoal(
  taskId: string,
  command: PromoteTaskToGoalRequest,
) {
  return apiJson<GoalData>(
    `/api/tasks/${encodeURIComponent(taskId)}/actions/promote-to-goal`,
    { method: "POST", body: JSON.stringify(command) },
  );
}

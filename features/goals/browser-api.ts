import { apiJson } from "@shared/http";
import type {
  CreateGoalTaskRequest,
  GoalActionRequest,
  PromoteTaskToGoalRequest,
} from "@chrona/contracts";
import type { GoalArtifactData, GoalData } from "./model/goal-types";

export async function runGoalAction(goalId: string, command: GoalActionRequest) {
  return apiJson<GoalData>(`/api/goals/${encodeURIComponent(goalId)}/actions`, {
    method: "POST",
    body: JSON.stringify(command),
  });
}

export async function createGoalTask(
  goalId: string,
  command: CreateGoalTaskRequest,
) {
  return apiJson<{ taskId: string; goal: GoalData }>(
    `/api/goals/${encodeURIComponent(goalId)}/tasks`,
    { method: "POST", body: JSON.stringify(command) },
  );
}

export async function getGoalArtifact(goalId: string, artifactId: string) {
  return apiJson<GoalArtifactData>(
    `/api/goals/${encodeURIComponent(goalId)}/artifacts/${encodeURIComponent(artifactId)}`,
  );
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

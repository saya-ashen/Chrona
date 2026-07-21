import { apiJson } from "@shared/http";
import type {
  ApplyGoalReviewRequest,
  ConfirmGoalCriterionRequest,
  CreateGoalRequest,
  CreateGoalWithFirstTaskRequest,
  CreateGoalTaskRequest,
  GoalActionRequest,
  GoalOperationalBrief,
  GoalWorkingSetSelection,
  ProcessGoalResultRequest,
  PromoteTaskToGoalRequest,
  ReviewGoalCriterionRequest,
} from "@chrona/contracts";
import type { GoalArtifactData, GoalData } from "./model/goal-types";

export async function createGoal(command: CreateGoalRequest) {
  return apiJson<GoalData>("/api/goals", {
    method: "POST",
    body: JSON.stringify(command),
  });
}
export async function createGoalWithFirstTask(command: CreateGoalWithFirstTaskRequest) {
  return apiJson<{ goal: GoalData; taskId: string }>("/api/goals/with-first-task", {
    method: "POST",
    body: JSON.stringify(command),
  });
}
export async function updateGoal(goalId: string, patch: { title?: string }) {
  return apiJson<GoalData>(`/api/goals/${encodeURIComponent(goalId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}


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

export async function updateGoalBrief(goalId: string, brief: GoalOperationalBrief) {
  return apiJson<GoalData>(`/api/goals/${encodeURIComponent(goalId)}/brief`, {
    method: "PUT",
    body: JSON.stringify({ brief }),
  });
}

export async function updateGoalWorkingSet(goalId: string, selections: GoalWorkingSetSelection[]) {
  return apiJson<GoalData>(`/api/goals/${encodeURIComponent(goalId)}/working-set`, {
    method: "PUT",
    body: JSON.stringify({ selections }),
  });
}

export async function processGoalResult(
  goalId: string,
  taskId: string,
  command: ProcessGoalResultRequest,
) {
  return apiJson<GoalData>(
    `/api/goals/${encodeURIComponent(goalId)}/results/${encodeURIComponent(taskId)}/process`,
    { method: "POST", body: JSON.stringify(command) },
  );
}

export async function reviewGoalCriterion(
  goalId: string,
  criterionId: string,
  command: ReviewGoalCriterionRequest,
) {
  return apiJson<GoalData>(
    `/api/goals/${encodeURIComponent(goalId)}/criteria/${encodeURIComponent(criterionId)}/review`,
    { method: "POST", body: JSON.stringify(command) },
  );
}

export async function confirmGoalCriterion(
  goalId: string,
  criterionId: string,
  command: ConfirmGoalCriterionRequest,
) {
  return apiJson<GoalData>(
    `/api/goals/${encodeURIComponent(goalId)}/criteria/${encodeURIComponent(criterionId)}/confirm`,
    { method: "POST", body: JSON.stringify(command) },
  );
}

export async function applyGoalReview(goalId: string, command: ApplyGoalReviewRequest) {
  return apiJson<GoalData>(`/api/goals/${encodeURIComponent(goalId)}/reviews/apply`, {
    method: "POST",
    body: JSON.stringify(command),
  });
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

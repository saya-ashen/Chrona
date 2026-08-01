import { v4 as uuidv4 } from "uuid";
import { apiJson, fetchJsonEventSource } from "@shared/http";
import {
  aiRunProgressEventSchema,
  type AiRunProgressEvent,
  type ApplyGoalReviewRequest,
  type ApplyGoalReviewProposalRequest,
  type ConfirmGoalCriterionRequest,
  type CreateGoalRequest,
  type CreateGoalWithFirstTaskRequest,
  type CreateGoalTaskRequest,
  type GenerateGoalReviewRequest,
  type GoalActionRequest,
  type GoalOperationalBrief,
  type ProcessGoalResultRequest,
  type PromoteTaskToGoalRequest,
  type ReviewGoalCriterionRequest,
  type RejectGoalReviewProposalRequest,
} from "@chrona/contracts";
import type { GoalArtifactData, GoalData } from "./model/goal-types";

const GOAL_REVIEW_PROGRESS_TIMEOUT_MS = 10 * 60 * 1000;

export type GenerateGoalReviewOptions = {
  onProgress?: (event: AiRunProgressEvent) => void;
  signal?: AbortSignal;
};
function abortableDelay(milliseconds: number, signal: AbortSignal) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = window.setTimeout(resolve, milliseconds);
  signal.addEventListener("abort", () => {
    window.clearTimeout(timer);
    reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }, { once: true });
  return promise;
}
async function subscribeToGoalReviewProgress(
  operationId: string,
  options: GenerateGoalReviewOptions,
  signal: AbortSignal,
) {
  for (let attempt = 0; attempt < 8 && !signal.aborted; attempt += 1) {
    let retry = false;
    await fetchJsonEventSource(`/api/ai/runs/${encodeURIComponent(operationId)}/events`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
      onEvent({ event, data }) {
        if (event !== "progress") return;
        const parsed = aiRunProgressEventSchema.safeParse(data);
        if (!parsed.success || parsed.data.operationId !== operationId || parsed.data.feature !== "goal.review") return;
        options.onProgress?.(parsed.data);
      },
      onNonStreamResponse(response) {
        retry = response.status === 404;
      },
    });
    if (!retry || signal.aborted || attempt === 7) return;
    await abortableDelay(75 * (attempt + 1), signal);
  }
}

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

export async function generateGoalReview(
  goalId: string,
  command: GenerateGoalReviewRequest,
  options: GenerateGoalReviewOptions = {},
) {
  const operationId = command.progressId ?? uuidv4();
  const requestCommand = { ...command, progressId: operationId };
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), GOAL_REVIEW_PROGRESS_TIMEOUT_MS);
  const progress = subscribeToGoalReviewProgress(operationId, options, controller.signal)
    .catch(() => undefined);
  try {
    const result = await apiJson<{ proposalId: string; status: string }>(
      `/api/goals/${encodeURIComponent(goalId)}/reviews/generate`,
      { method: "POST", body: JSON.stringify(requestCommand), signal: controller.signal },
    );
    await progress;
    return result;
  } finally {
    controller.abort();
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    await progress;
  }
}

export async function applyGoalReviewProposal(
  goalId: string,
  proposalId: string,
  command: ApplyGoalReviewProposalRequest,
) {
  return apiJson(
    `/api/goals/${encodeURIComponent(goalId)}/reviews/${encodeURIComponent(proposalId)}/apply`,
    { method: "POST", body: JSON.stringify(command) },
  );
}

export async function rejectGoalReviewProposal(
  goalId: string,
  proposalId: string,
  command: RejectGoalReviewProposalRequest,
) {
  return apiJson(
    `/api/goals/${encodeURIComponent(goalId)}/reviews/${encodeURIComponent(proposalId)}/reject`,
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

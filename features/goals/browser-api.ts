import { v4 as uuidv4 } from "uuid";
import { apiJson, fetchJsonEventSource } from "@shared/http";
import {
  type ConfirmGoalCriterionRequest,
  type AiJsonValue,
  type CreateGoalRequest,
  type CreateGoalWithFirstTaskRequest,
  type CreateGoalTaskRequest,
  type GoalActionRequest,
  type GoalOperationalBrief,
  type ProcessGoalResultRequest,
  type PromoteTaskToGoalRequest,
  type ReviewGoalCriterionRequest,
} from "@chrona/contracts";
import type { GoalArtifactData, GoalData, GoalReviewProgressEvent } from "./model/goal-types";

const GOAL_REVIEW_PROGRESS_TIMEOUT_MS = 10 * 60 * 1000;

export type GenerateGoalReviewOptions = {
  onProgress?: (event: GoalReviewProgressEvent) => void;
  signal?: AbortSignal;
};

export type GenerateGoalReviewRequest = {
  idempotencyKey: string;
  operationId?: string;
  mode: "initial" | "progress";
};

export type AnswerGoalReviewRequest = {
  operationId?: string;
  expectedVersion: number;
  answers: Array<{ questionId: string; answer: AiJsonValue }>;
};

export type RetryGoalReviewRequest = {
  operationId?: string;
  expectedVersion: number;
};

export type ApplyGoalReviewProposalRequest = {
  idempotencyKey: string;
  expectedVersion: number;
  expectedGoalUpdatedAt: string;
  dependencyHashes: Record<string, string>;
  decisions: Array<{ itemId: string; action: "accept" | "reject" | "convert_to_task" | "ignore" }>;
};

export type RejectGoalReviewProposalRequest = { idempotencyKey: string };

type GoalReviewCommandResult = { proposalId: string; status: string; version: number };

function parseGoalReviewProgressEvent(value: Record<string, unknown>, proposalId: string): GoalReviewProgressEvent | null {
  if (
    value.proposalId !== proposalId
    || typeof value.status !== "string"
    || typeof value.version !== "number"
  ) return null;
  return {
    proposalId,
    status: value.status,
    version: value.version,
    ...(typeof value.message === "string" ? { message: value.message } : {}),
    ...(typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}),
  };
}

async function subscribeToGoalReviewProgress(
  goalId: string,
  proposalId: string,
  options: GenerateGoalReviewOptions,
  signal: AbortSignal,
) {
  await fetchJsonEventSource(
    `/api/goals/${encodeURIComponent(goalId)}/review-proposals/${encodeURIComponent(proposalId)}/progress`,
    {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal,
      onEvent({ event, data }) {
        if (event !== "progress") return;
        const progress = parseGoalReviewProgressEvent(data, proposalId);
        if (progress) options.onProgress?.(progress);
      },
    },
  );
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

export async function generateGoalReview(
  goalId: string,
  command: GenerateGoalReviewRequest,
  options: GenerateGoalReviewOptions = {},
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), GOAL_REVIEW_PROGRESS_TIMEOUT_MS);
  const stop = () => {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  };
  const result = await apiJson<GoalReviewCommandResult>(
    `/api/goals/${encodeURIComponent(goalId)}/review-proposals/generate`,
    {
      method: "POST",
      body: JSON.stringify({ ...command, operationId: command.operationId ?? uuidv4() }),
      signal: controller.signal,
    },
  );
  void subscribeToGoalReviewProgress(goalId, result.proposalId, options, controller.signal)
    .catch(() => undefined)
    .finally(stop);
  return result;
}

export async function answerGoalReview(
  goalId: string,
  proposalId: string,
  command: AnswerGoalReviewRequest,
) {
  return apiJson<GoalReviewCommandResult>(
    `/api/goals/${encodeURIComponent(goalId)}/review-proposals/${encodeURIComponent(proposalId)}/answers`,
    {
      method: "POST",
      body: JSON.stringify({ ...command, operationId: command.operationId ?? uuidv4() }),
    },
  );
}

export async function retryGoalReview(
  goalId: string,
  proposalId: string,
  command: RetryGoalReviewRequest,
) {
  return apiJson<GoalReviewCommandResult>(
    `/api/goals/${encodeURIComponent(goalId)}/review-proposals/${encodeURIComponent(proposalId)}/retry`,
    {
      method: "POST",
      body: JSON.stringify({ ...command, operationId: command.operationId ?? uuidv4() }),
    },
  );
}

export async function applyGoalReviewProposal(
  goalId: string,
  proposalId: string,
  command: ApplyGoalReviewProposalRequest,
) {
  return apiJson(
    `/api/goals/${encodeURIComponent(goalId)}/review-proposals/${encodeURIComponent(proposalId)}/apply`,
    { method: "POST", body: JSON.stringify(command) },
  );
}

export async function rejectGoalReviewProposal(
  goalId: string,
  proposalId: string,
  command: RejectGoalReviewProposalRequest,
) {
  return apiJson(
    `/api/goals/${encodeURIComponent(goalId)}/review-proposals/${encodeURIComponent(proposalId)}/reject`,
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

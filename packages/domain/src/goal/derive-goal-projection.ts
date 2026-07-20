import type { GoalSuccessCriterion, GoalStatus } from "@chrona/contracts/api";

export type GoalAttention = "none" | "needs_input" | "blocked" | "failed";
export type GoalActivity = "idle" | "work_active" | "review_due";
export type GoalNextAction = "review" | "resolve_attention" | "resume" | "confirm_outcome" | "none";

export type GoalTaskProjectionInput = {
  status: string;
  blockType?: string | null;
};

export type GoalProjectionInput = {
  status: GoalStatus;
  nextReviewAt: string | Date | null;
  tasks: readonly GoalTaskProjectionInput[];
  successCriteria: readonly GoalSuccessCriterion[];
  now?: string | Date;
};

export type GoalProjection = {
  lifecycle: GoalStatus;
  activity: GoalActivity;
  attention: GoalAttention;
  nextAction: GoalNextAction;
  completedTaskCount: number;
  totalTaskCount: number;
  criteriaSatisfiedCount: number;
  criteriaTotalCount: number;
};

const activeTaskStatuses = new Set(["Queued", "Running"]);

export function deriveGoalProjection(input: GoalProjectionInput): GoalProjection {
  const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
  const reviewDue =
    input.status === "Active" &&
    input.nextReviewAt !== null &&
    new Date(input.nextReviewAt).getTime() <= now.getTime();
  const workActive = input.tasks.some((task) => activeTaskStatuses.has(task.status));
  const hasNeedsInput = input.tasks.some((task) =>
    task.status === "WaitingForInput" || task.status === "WaitingForApproval",
  );
  const hasBlocked = input.tasks.some((task) => task.status === "Blocked");
  const hasFailed = input.tasks.some((task) => task.status === "Failed");

  const attention: GoalAttention = hasNeedsInput
    ? "needs_input"
    : hasBlocked
      ? "blocked"
      : hasFailed
        ? "failed"
        : "none";
  const activity: GoalActivity = workActive ? "work_active" : reviewDue ? "review_due" : "idle";
  const criteriaSatisfiedCount = input.successCriteria.filter((criterion) => criterion.satisfied).length;

  let nextAction: GoalNextAction = "none";
  if (input.status === "Paused") nextAction = "resume";
  else if (input.status === "Active" && attention !== "none") nextAction = "resolve_attention";
  else if (input.status === "Active" && reviewDue) nextAction = "review";
  else if (
    input.status === "Active" &&
    input.successCriteria.length > 0 &&
    criteriaSatisfiedCount === input.successCriteria.length
  ) nextAction = "confirm_outcome";

  return {
    lifecycle: input.status,
    activity,
    attention,
    nextAction,
    completedTaskCount: input.tasks.filter((task) => task.status === "Completed").length,
    totalTaskCount: input.tasks.length,
    criteriaSatisfiedCount,
    criteriaTotalCount: input.successCriteria.length,
  };
}

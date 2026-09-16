import { db, type Prisma } from "@chrona/db";
import type { ManagementGoalRead, ManagementGoalSearch } from "@chrona/contracts/api";
import { stableJsonHash } from "../ai";
import type { ManagementIdentity } from "./clients";
import { ManagementError } from "./errors";
import { record, requireScopes, text } from "./reads";
import { editableGoalStatuses, goalEditRevision, readGoalUpdateHistory } from "./goal-updates";

const goalSelect = {
  id: true, title: true, description: true, status: true, configRevision: true,
  operationalBrief: true, successCriteria: true, nextReviewAt: true,
  createdAt: true, updatedAt: true,
  _count: { select: { tasks: true, assets: true } },
} satisfies Prisma.GoalSelect;
const goalUrl = (client: ManagementIdentity, id: string) => new URL(`/goals/${encodeURIComponent(id)}`, client.publicUrl).href;

export async function searchManagementGoals(client: ManagementIdentity, input: ManagementGoalSearch) {
  requireScopes(client, ["goals:read"]);
  const where: Prisma.GoalWhereInput = {
    workspaceId: client.workspaceId, status: input.status,
    ...(input.query ? { OR: [{ title: { contains: input.query } }, { description: { contains: input.query } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.goal.findMany({
      where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: input.pageSize, skip: (input.page - 1) * input.pageSize,
      select: { id: true, title: true, description: true, status: true, nextReviewAt: true, updatedAt: true },
    }),
    db.goal.count({ where }),
  ]);
  return {
    total, page: input.page, pageSize: input.pageSize,
    hasMore: input.page < 1_000 && input.page * input.pageSize < total,
    paginationLimitReached: input.page === 1_000 && input.page * input.pageSize < total,
    items: rows.map((goal) => ({
      goalId: goal.id, title: text(goal.title, 200), titleTruncated: goal.title.length > 200,
      descriptionPreview: text(goal.description, 200), descriptionTruncated: (goal.description?.length ?? 0) > 200,
      status: goal.status, nextReviewAt: goal.nextReviewAt, updatedAt: goal.updatedAt,
      url: goalUrl(client, goal.id),
    })),
  };
}

function goalEditability(client: ManagementIdentity, status: string) {
  const disabledReason = !client.scopes.includes("goals:write") ? "Requires goals:write" : !editableGoalStatuses.includes(status) ? "Archived Goal" : null;
  return { canUpdate: disabledReason === null, disabledReason };
}

export async function readManagementGoal(client: ManagementIdentity, input: ManagementGoalRead) {
  requireScopes(client, ["goals:read"]);
  const goal = await db.goal.findFirst({ where: { id: input.goalId, workspaceId: client.workspaceId }, select: goalSelect });
  if (!goal) throw new ManagementError("NOT_FOUND", "Goal not found");
  const common = {
    goal: { goalId: goal.id, title: text(goal.title, 200), titleTruncated: goal.title.length > 200, status: goal.status, url: goalUrl(client, goal.id), createdAt: goal.createdAt, updatedAt: goal.updatedAt },
    // An observational fingerprint, not a permission grant or a mutation token.
    revision: `goal-snapshot-v1:${stableJsonHash(goal)}`,
    editRevision: goalEditRevision(goal.configRevision),
    editability: goalEditability(client, goal.status),
    nextReviewAt: goal.nextReviewAt, taskCount: goal._count.tasks, assetCount: goal._count.assets,
    activationAvailable: false, permissionGrantsAvailable: false,
  };
  if (input.view === "compact") return common;
  if (input.view === "history") return { ...common, history: await readGoalUpdateHistory(client, goal.id, input.page, input.pageSize) };
  if (input.view === "brief") {
    const brief = record(goal.operationalBrief);
    const constraints = Array.isArray(brief.constraints) ? brief.constraints : [];
    return {
      ...common, description: text(goal.description, 5_000), descriptionTruncated: (goal.description?.length ?? 0) > 5_000,
      brief: {
        outcome: text(brief.outcome, 2_000), currentFocus: text(brief.currentFocus, 2_000), strategy: text(brief.strategy, 2_000),
        constraints: constraints.filter((value): value is string => typeof value === "string").slice(0, 16).map((value) => value.slice(0, 2_000)),
      },
      briefTruncated: [brief.outcome, brief.currentFocus, brief.strategy, ...constraints].some((value) => typeof value === "string" && value.length > 2_000) || constraints.length > 16,
      constraintsAreNotPermissionGrants: true,
    };
  }
  const criteria = Array.isArray(goal.successCriteria) ? goal.successCriteria : [];
  return {
    ...common, criteria: criteria.slice(0, 20).map((value) => {
      const criterion = record(value);
      return {
        id: text(criterion.id, 128), description: text(criterion.description, 2_000),
        satisfied: criterion.satisfied === true, confirmedAt: text(criterion.confirmedAt, 40),
        proposalStatus: criterion.proposalStatus === "proposed" ? "proposed" : criterion.proposalStatus === "confirmed" ? "confirmed" : "unknown",
      };
    }),
    criteriaTruncated: criteria.length > 20 || criteria.some((value) => {
      const criterion = record(value);
      return typeof criterion.description === "string" && criterion.description.length > 2_000 || typeof criterion.id === "string" && criterion.id.length > 128;
    }),
  };
}

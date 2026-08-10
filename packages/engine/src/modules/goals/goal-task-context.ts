import { createHash } from "node:crypto";
import { db, Prisma } from "@chrona/db";
import { extractAcceptedResultText } from "../tasks/accepted-result-context";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

const GOAL_CONTEXT_RESULT_LIMIT = 8;
const GOAL_CONTEXT_SUMMARY_LIMIT = 400;
const GOAL_CONTEXT_ASSET_TITLE_LIMIT = 160;
const GOAL_CONTEXT_ASSET_DESCRIPTION_LIMIT = 400;

type GoalContextClient = Prisma.TransactionClient | typeof db;

type GoalContextExtra = Prisma.InputJsonObject | undefined;
type FormalAssetCatalogInput = {
  assets: Array<{
    id: string;
    label: string;
    kind: string;
    role: string;
    description: string | null;
    updatedAt: Date;
    versions: Array<{ version: number }>;
  }>;
};
export type FrozenGoalAsset = {
  ref: string;
  title: string;
  description: string;
  kind: string;
  role: string;
  version: number;
  updatedAt: string;
};

export type FrozenGoalAcceptedResult = {
  ref: string;
  taskTitle: string;
  acceptedAt: string | null;
  summary: string;
  artifactCount: number;
};

export type FrozenGoalTaskContext = {
  assets: FrozenGoalAsset[];
  acceptedResults: FrozenGoalAcceptedResult[];
};

const GOAL_ASSET_REF_PATTERN = /^GA[0-9A-F]{12}$/;
const GOAL_RESULT_REF_PATTERN = /^GR[0-9A-F]{12}$/;

export function parseFrozenGoalTaskContext(value: unknown): FrozenGoalTaskContext {
  const context = record(value);
  const assets = Array.isArray(context?.assets)
    ? context.assets.flatMap((item): FrozenGoalAsset[] => {
        const asset = record(item);
        if (
          !asset
          || typeof asset.ref !== "string"
          || !GOAL_ASSET_REF_PATTERN.test(asset.ref)
          || typeof asset.title !== "string"
          || typeof asset.description !== "string"
          || typeof asset.kind !== "string"
          || typeof asset.role !== "string"
          || !Number.isInteger(asset.version)
          || (asset.version as number) < 1
          || typeof asset.updatedAt !== "string"
        ) return [];
        return [{
          ref: asset.ref,
          title: asset.title,
          description: asset.description,
          kind: asset.kind,
          role: asset.role,
          version: asset.version as number,
          updatedAt: asset.updatedAt,
        }];
      })
    : [];
  const acceptedResults = Array.isArray(context?.acceptedResults)
    ? context.acceptedResults.flatMap((item): FrozenGoalAcceptedResult[] => {
        const result = record(item);
        if (
          !result
          || typeof result.ref !== "string"
          || !GOAL_RESULT_REF_PATTERN.test(result.ref)
          || typeof result.taskTitle !== "string"
          || typeof result.summary !== "string"
          || typeof result.artifactCount !== "number"
        ) return [];
        return [{
          ref: result.ref,
          taskTitle: result.taskTitle,
          acceptedAt: typeof result.acceptedAt === "string" ? result.acceptedAt : null,
          summary: result.summary,
          artifactCount: result.artifactCount,
        }];
      })
    : [];
  return { assets, acceptedResults };
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function boundedText(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}
function assetDescription(description: string | null) {
  return description
    ? boundedText(description, GOAL_CONTEXT_ASSET_DESCRIPTION_LIMIT)
    : "";
}


export function goalAcceptedResultRef(runId: string) {
  return `GR${createHash("sha256").update(runId).digest("hex").slice(0, 12).toUpperCase()}`;
}

export function goalAssetRef(assetId: string) {
  return `GA${createHash("sha256").update(assetId).digest("hex").slice(0, 12).toUpperCase()}`;
}


function formalAssetCatalog(goal: FormalAssetCatalogInput) {
  return goal.assets.map((asset) => {
    const version = asset.versions[0]?.version;
    if (typeof version !== "number") {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "Approved Goal asset is missing a formal version",
      );
    }
    return {
      ref: goalAssetRef(asset.id),
      title: boundedText(asset.label, GOAL_CONTEXT_ASSET_TITLE_LIMIT),
      description: assetDescription(asset.description),
      kind: asset.kind,
      role: asset.role,
      version,
      updatedAt: asset.updatedAt.toISOString(),
    };
  });
}

function planOutputSpec(value: unknown) {
  const planRun = record(value);
  const mutableGraph = record(planRun?.mutableGraph);
  const planOutput = record(mutableGraph?.planOutput);
  return record(planOutput?.finalizedResult)?.spec ?? null;
}

function acceptedResultCatalog(goal: Awaited<ReturnType<typeof loadGoalContext>>) {
  if (!goal) return [];
  return goal.tasks
    .flatMap((task) => {
      const payload = record(task.events[0]?.payload);
      const runId = typeof payload?.accepted_run_id === "string" ? payload.accepted_run_id : null;
      if (!runId) return [];
      const run = task.runs.find((candidate) => candidate.id === runId);
      if (!run) return [];
      const runtimeConfig = record(run.runtimeConfigSnapshot);
      const planId = typeof runtimeConfig?.planId === "string" ? runtimeConfig.planId : null;
      const planRun = task.taskPlanRuns.find((candidate) =>
        (planId && candidate.planId === planId) || candidate.workBlockId === run.workBlockId,
      ) ?? task.taskPlanRuns[0];
      const extracted = extractAcceptedResultText(planRun ? planOutputSpec(planRun.planRun) : null);
      const summary = extracted.startsWith("No structured result content")
        ? task.description ?? "The accepted result did not include a readable summary."
        : extracted;
      const acceptedAtValue = payload?.accepted_at;
      const acceptedAt = typeof acceptedAtValue === "string"
        ? acceptedAtValue
        : task.events[0]?.occurredAt?.toISOString() ?? run.endedAt?.toISOString() ?? null;
      return [{
        ref: goalAcceptedResultRef(run.id),
        taskTitle: task.title,
        acceptedAt,
        summary: boundedText(summary, GOAL_CONTEXT_SUMMARY_LIMIT),
        artifactCount: run.artifacts.length,
      }];
    })
    .sort((left, right) => (right.acceptedAt ?? "").localeCompare(left.acceptedAt ?? ""))
    .slice(0, GOAL_CONTEXT_RESULT_LIMIT);
}

function loadGoalContext(goalId: string, client: GoalContextClient) {
  return client.goal.findUnique({
    where: { id: goalId },
    select: {
      workspaceId: true,
      title: true,
      description: true,
      operationalBrief: true,
      assets: {
        where: { status: "Approved", archivedAt: null },
        orderBy: [{ updatedAt: "desc" as const }, { id: "asc" as const }],
        select: {
          id: true,
          label: true,
          kind: true,
          role: true,
          updatedAt: true,
          description: true,
          versions: {
            orderBy: { version: "desc" as const },
            take: 1,
            select: { version: true },
          },
        },
      },
      tasks: {
        orderBy: [{ updatedAt: "desc" as const }, { id: "asc" as const }],
        select: {
          title: true,
          description: true,
          events: {
            where: { eventType: "task.result_accepted" },
            orderBy: [{ ingestSequence: "desc" as const }, { createdAt: "desc" as const }],
            take: 1,
            select: { payload: true, occurredAt: true },
          },
          runs: {
            where: { status: "Completed" },
            orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
            select: {
              id: true,
              endedAt: true,
              runtimeConfigSnapshot: true,
              workBlockId: true,
              artifacts: { select: { id: true } },
            },
          },
          taskPlanRuns: {
            orderBy: { updatedAt: "desc" },
            select: { planId: true, workBlockId: true, planRun: true },
          },
        },
      },
    },
  });
}

export async function buildAutomaticGoalTaskContext(
  input: { goalId: string; workspaceId: string; additionalContext?: GoalContextExtra },
  client: GoalContextClient = db,
): Promise<Prisma.InputJsonObject> {
  const goal = await loadGoalContext(input.goalId, client);
  if (!goal || goal.workspaceId !== input.workspaceId) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal not found");
  }
  return JSON.parse(JSON.stringify({
    ...(input.additionalContext ?? {}),
    goal: {
      title: goal.title,
      additionalContext: goal.description,
      operationalBrief: goal.operationalBrief,
      capturedAt: new Date().toISOString(),
    },
    acceptedResults: acceptedResultCatalog(goal),
    assets: formalAssetCatalog(goal),
  })) as Prisma.InputJsonObject;
}

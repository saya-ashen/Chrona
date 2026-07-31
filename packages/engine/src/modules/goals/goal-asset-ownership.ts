import { createHash } from "node:crypto";
import { db, Prisma } from "@chrona/db";
import {
  applyGoalAssetOwnershipBodySchema,
  buildGoalAssetOwnershipFeatureSpec,
  goalAssetOwnershipResultSchema,
  type ApplyGoalAssetOwnershipRequest,
  type GenerateGoalAssetOwnershipRequest,
  type GoalAssetOwnershipResult,
  type ResolveGoalInboxCandidateRequest,
} from "@chrona/contracts";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import {
  dispatchPreparedFeaturePayload,
  getAiClientForFeature,
} from "../ai";
import { resolveGoalInboxCandidate } from "./goal-workbench";

const SCHEMA_VERSION = 1;

type OwnershipSnapshot = {
  candidate: {
    id: string;
    goalId: string;
    kind: "document" | "form" | "page" | "file" | "data_table" | "structured_result";
    label: string;
    content: unknown;
    contentHash: string;
    ruleRecommendation: {
      action: string;
      targetAssetId: string | null;
      reason: string;
    };
  };
  provenance: {
    acceptedTaskId: string;
    acceptedTaskTitle: string;
    acceptedRunId: string;
    artifactId: string | null;
    artifactTitle: string | null;
    artifactType: string | null;
    artifactContentPreview: string | null;
  };
  candidateAssets: Array<{
    assetId: string;
    label: string;
    kind: "document" | "form" | "page" | "file" | "data_table" | "structured_result";
    currentVersionId: string;
    currentVersion: number;
    contentHash: string;
  }>;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

function hashValue(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

function asJsonObject(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}


async function snapshotCandidate(input: {
  goalId: string;
  candidateId: string;
  workspaceId: string;
}): Promise<OwnershipSnapshot> {
  const candidate = await db.goalInboxCandidate.findFirst({
    where: {
      id: input.candidateId,
      goalId: input.goalId,
      workspaceId: input.workspaceId,
      status: "Pending",
    },
    include: { sourceTask: true, sourceArtifact: true },
  });
  if (!candidate) {
    throw new EngineError(
      ENGINE_ERROR_CODES.TASK_NOT_FOUND,
      "Inbox candidate not found",
    );
  }

  const assets = await db.goalAsset.findMany({
    where: {
      goalId: input.goalId,
      workspaceId: input.workspaceId,
      kind: candidate.kind,
      archivedAt: null,
    },
    orderBy: { id: "asc" },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });

  return {
    candidate: {
      id: candidate.id,
      goalId: candidate.goalId,
      kind: candidate.kind,
      label: candidate.label,
      content: candidate.content,
      contentHash: candidate.contentHash,
      ruleRecommendation: {
        action: candidate.proposedAction,
        targetAssetId: candidate.proposedTargetAssetId,
        reason: candidate.reason,
      },
    },
    provenance: {
      acceptedTaskId: candidate.sourceTaskId,
      acceptedTaskTitle: candidate.sourceTask.title,
      acceptedRunId: candidate.sourceRunId,
      artifactId: candidate.sourceArtifactId,
      artifactTitle: candidate.sourceArtifact?.title ?? null,
      artifactType: candidate.sourceArtifact?.type ?? null,
      artifactContentPreview: candidate.sourceArtifact?.contentPreview ?? null,
    },
    candidateAssets: assets.flatMap((asset) => {
      const version = asset.versions[0];
      return version
        ? [
            {
              assetId: asset.id,
              label: asset.label,
              kind: asset.kind,
              currentVersionId: version.id,
              currentVersion: version.version,
              contentHash: version.contentHash,
            },
          ]
        : [];
    }),
  };
}

function validateReferences(
  snapshot: OwnershipSnapshot,
  result: GoalAssetOwnershipResult,
) {
  if (
    result.targetAssetId &&
    !snapshot.candidateAssets.some(
      (candidate) => candidate.assetId === result.targetAssetId,
    )
  ) {
    throw new Error(
      `Asset ownership result references unknown target asset: ${result.targetAssetId}`,
    );
  }
}

async function markGenerationFailed(proposalId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await db.goalAssetOwnershipProposal.updateMany({
    where: { id: proposalId, status: "Generating" },
    data: { status: "Failed", generationError: message },
  });
  return message;
}

const generationPromises = new Map<string, Promise<unknown>>();

export function waitForGoalAssetOwnershipGeneration(proposalId: string) {
  return generationPromises.get(proposalId) ?? Promise.resolve();
}

export async function generateGoalAssetOwnership(input: {
  goalId: string;
  candidateId: string;
  command: GenerateGoalAssetOwnershipRequest;
}) {
  const existing = await db.goalAssetOwnershipProposal.findUnique({
    where: {
      inboxCandidateId_requestIdempotencyKey: {
        inboxCandidateId: input.candidateId,
        requestIdempotencyKey: input.command.idempotencyKey,
      },
    },
  });
  if (existing) return { proposalId: existing.id, status: existing.status };

  const snapshot = await snapshotCandidate({
    goalId: input.goalId,
    candidateId: input.candidateId,
    workspaceId: input.command.workspaceId,
  });
  const proposal = await db.goalAssetOwnershipProposal.create({
    data: {
      workspaceId: input.command.workspaceId,
      goalId: input.goalId,
      inboxCandidateId: input.candidateId,
      inputSnapshot: asJsonObject(snapshot),
      inputHash: hashValue(snapshot),
      requestIdempotencyKey: input.command.idempotencyKey,
      schemaVersion: SCHEMA_VERSION,
    },
  });
  await db.event.create({
    data: {
      eventType: "goal.asset_ownership_generation_started",
      workspaceId: input.command.workspaceId,
      actorType: "user",
      actorId: "server-action",
      source: "ui",
      payload: {
        goal_id: input.goalId,
        candidate_id: input.candidateId,
        proposal_id: proposal.id,
      },
      dedupeKey: `goal.asset_ownership_generation_started:${proposal.id}`,
      ingestSequence: 0,
    },
  });
  const generationPromise = runGoalAssetOwnershipGeneration({ proposalId: proposal.id });
  generationPromises.set(proposal.id, generationPromise);
  void generationPromise
    .finally(() => generationPromises.delete(proposal.id))
    .catch(() => undefined);
  return { proposalId: proposal.id, status: proposal.status };
}

export async function runGoalAssetOwnershipGeneration(input: {
  proposalId: string;
}) {
  const proposal = await db.goalAssetOwnershipProposal.findUnique({
    where: { id: input.proposalId },
  });
  if (!proposal || proposal.status !== "Generating") return proposal;

  try {
    const client = await getAiClientForFeature("goal.asset_ownership");
    if (!client) {
      throw new Error("No AI client is configured for Asset Ownership");
    }
    const featureSpec = buildGoalAssetOwnershipFeatureSpec();
    featureSpec.inputText = JSON.stringify(
      {
        snapshot: proposal.inputSnapshot,
        snapshotHash: proposal.inputHash,
        schemaVersion: SCHEMA_VERSION,
      },
      null,
      2,
    );
    const invocation = await dispatchPreparedFeaturePayload<GoalAssetOwnershipResult>(
      client,
      featureSpec,
      `goal-asset-ownership:${proposal.id}`,
      { toolPolicy: "read_only" },
    );
    const parsed = goalAssetOwnershipResultSchema.safeParse(invocation.parsed);
    if (!parsed.success) {
      throw new Error(
        `Asset Ownership returned an invalid structured result: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    const snapshot = proposal.inputSnapshot as unknown as OwnershipSnapshot;
    validateReferences(snapshot, parsed.data);
    const config = record(client.record.config);
    await db.$transaction(
      async (tx) => {
        const current = await tx.goalAssetOwnershipProposal.findUnique({
          where: { id: proposal.id },
          select: { status: true },
        });
        if (current?.status !== "Generating") return;
        await tx.goalAssetOwnershipProposal.update({
          where: { id: proposal.id },
          data: {
            status: "Ready",
            result: asJsonObject(parsed.data),
            decision: parsed.data.decision,
            targetAssetId: parsed.data.targetAssetId,
            providerType: client.record.type,
            model: typeof config?.model === "string" ? config.model : null,
            generationError: null,
            readyAt: new Date(),
          },
        });
        await tx.event.create({
          data: {
            eventType: "goal.asset_ownership_proposal_ready",
            workspaceId: proposal.workspaceId,
            actorType: "agent",
            actorId: client.record.type,
            source: "ai_feature",
            payload: {
              goal_id: proposal.goalId,
              candidate_id: proposal.inboxCandidateId,
              proposal_id: proposal.id,
              decision: parsed.data.decision,
              provider_client_id: client.record.id,
              provider_run_id: invocation.debug?.runId ?? null,
            },
            summary: parsed.data.rationale,
            dedupeKey: `goal.asset_ownership_proposal_ready:${proposal.id}`,
            ingestSequence: 0,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return db.goalAssetOwnershipProposal.findUnique({ where: { id: proposal.id } });
  } catch (error) {
    const message = await markGenerationFailed(proposal.id, error);
    await db.event
      .create({
        data: {
          eventType: "goal.asset_ownership_proposal_failed",
          workspaceId: proposal.workspaceId,
          actorType: "system",
          actorId: "asset-ownership",
          source: "ai_feature",
          payload: {
            goal_id: proposal.goalId,
            candidate_id: proposal.inboxCandidateId,
            proposal_id: proposal.id,
            error: message,
          },
          summary: message,
          dedupeKey: `goal.asset_ownership_proposal_failed:${proposal.id}`,
          ingestSequence: 0,
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

function proposalResult(value: unknown): GoalAssetOwnershipResult {
  const parsed = goalAssetOwnershipResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new EngineError(
      ENGINE_ERROR_CODES.CONFLICT,
      "Asset ownership proposal has no valid result",
    );
  }
  return parsed.data;
}

async function resolveCommand(
  proposal: {
    inputSnapshot: unknown;
    result: unknown;
  },
  command: ApplyGoalAssetOwnershipRequest,
): Promise<ResolveGoalInboxCandidateRequest> {
  const result = proposalResult(proposal.result);
  if (command.action === "reject") {
    return { workspaceId: command.workspaceId, action: "reject" };
  }
  if (command.action === "create_asset") {
    if (!command.label) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "A label is required to create an asset",
      );
    }
    return {
      workspaceId: command.workspaceId,
      action: "create_asset",
      label: command.label,
    };
  }
  if (command.action === "append_version") {
    if (!command.targetAssetId || !command.baseVersionId) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "A target asset and base version are required",
      );
    }
    return {
      workspaceId: command.workspaceId,
      action: "append_version",
      targetAssetId: command.targetAssetId,
      baseVersionId: command.baseVersionId,
      changeSummary: command.changeSummary ?? "Inbox candidate appended after user confirmation",
    };
  }

  const snapshot = proposal.inputSnapshot as unknown as OwnershipSnapshot;
  if (result.decision === "append_version") {
    const target = snapshot.candidateAssets.find(
      (candidate) => candidate.assetId === result.targetAssetId,
    );
    if (!target) {
      throw new EngineError(
        ENGINE_ERROR_CODES.CONFLICT,
        "The suggested target asset is no longer available",
      );
    }
    return {
      workspaceId: command.workspaceId,
      action: "append_version",
      targetAssetId: target.assetId,
      baseVersionId: target.currentVersionId,
      changeSummary: result.differenceSummary,
    };
  }
  return {
    workspaceId: command.workspaceId,
    action: "create_asset",
    label: result.proposedLabel,
  };
}

export async function applyGoalAssetOwnershipProposal(input: {
  goalId: string;
  candidateId: string;
  proposalId: string;
  command: ApplyGoalAssetOwnershipRequest;
}) {
  const command = applyGoalAssetOwnershipBodySchema.parse(input.command);
  const proposal = await db.goalAssetOwnershipProposal.findFirst({
    where: {
      id: input.proposalId,
      goalId: input.goalId,
      inboxCandidateId: input.candidateId,
      workspaceId: command.workspaceId,
    },
  });
  if (!proposal) {
    throw new EngineError(
      ENGINE_ERROR_CODES.TASK_NOT_FOUND,
      "Asset ownership proposal not found",
    );
  }
  if (proposal.applicationKey === command.idempotencyKey) return proposal;
  if (proposal.status !== "Ready") {
    throw new EngineError(
      ENGINE_ERROR_CODES.CONFLICT,
      "Asset ownership proposal is not ready",
    );
  }

  if (command.action === "apply_suggestion") {
    const currentSnapshot = await snapshotCandidate({
      goalId: input.goalId,
      candidateId: input.candidateId,
      workspaceId: command.workspaceId,
    });
    if (hashValue(currentSnapshot) !== proposal.inputHash) {
      await db.goalAssetOwnershipProposal.update({
        where: { id: proposal.id },
        data: { status: "Stale" },
      });
      throw new EngineError(
        ENGINE_ERROR_CODES.CONFLICT,
        "Asset ownership proposal is stale because the Inbox candidate or candidate assets changed",
      );
    }
  }

  const resolution = await resolveCommand(proposal, command);
  const resolved = await resolveGoalInboxCandidate({
    goalId: input.goalId,
    candidateId: input.candidateId,
    command: resolution,
  });
  const assetId =
    resolved && typeof resolved === "object" && "assetId" in resolved
      ? String(resolved.assetId)
      : null;
  const status = command.action === "reject" ? "Rejected" : "Applied";
  const updated = await db.goalAssetOwnershipProposal.update({
    where: { id: proposal.id },
    data: {
      status,
      applicationKey: command.idempotencyKey,
      finalAction: command.action,
      finalAssetId: assetId,
      appliedAt: command.action === "reject" ? null : new Date(),
      rejectedAt: command.action === "reject" ? new Date() : null,
    },
  });
  await db.event.create({
    data: {
      eventType:
        command.action === "reject"
          ? "goal.asset_ownership_proposal_rejected"
          : "goal.asset_ownership_proposal_applied",
      workspaceId: proposal.workspaceId,
      taskId: null,
      source: "ui",
      actorType: "user",
      actorId: "server-action",
      payload: {
        goal_id: proposal.goalId,
        candidate_id: proposal.inboxCandidateId,
        proposal_id: proposal.id,
        final_action: command.action,
        final_asset_id: assetId,
      },
      dedupeKey: `goal.asset_ownership_proposal_resolution:${proposal.id}`,
      ingestSequence: 0,
    },
  });
  return updated;
}

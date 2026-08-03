import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { getChronaGeneratedFilesDir } from "@chrona/shared/data-paths";

import { db, Prisma } from "@chrona/db";
import {
  CATALOG_VERSION,
  chronaResultCatalog,
  validateChronaSpec,
  type UiDocument,
} from "@chrona/ui-protocol";
import {
  STRUCTURED_RESULT_FORMAT,
  STRUCTURED_RESULT_SCHEMA_VERSION,
  isStructuredResultAssetContent,
  type CreateAssetModificationTaskRequest,
  type CreateAssetUseTaskRequest,
  type CreateGoalAssetReviewRequest,
  type CreateGoalAssetJobRequest,
  type CreateGoalFormSubmissionRequest,
  type ResolveGoalInboxCandidateRequest,
  type SaveGoalAssetDraftRequest,
  type StructuredResultArtifactRef,
  type StructuredResultAssetContent,
  type SubmitGoalAssetDraftRequest,
} from "@chrona/contracts";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { createTask } from "../tasks/create-task";
import { getAcceptedResultContext } from "../tasks/accepted-result-context";
import { goalAssetRef } from "./goal-task-context";
import { requestResultFileAccess, resolveGeneratedFileReference } from "../tasks/result-file-access";
import { goalAssetContentToMarkdown } from "./goal-asset-export";

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function boundedDescription(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 400)
    : null;
}

function artifactDescription(metadata: unknown) {
  const value = record(metadata);
  return boundedDescription(value?.description ?? value?.summary);
}

function candidateDescription(candidate: {
  changeSummary: string;
  content: unknown;
  sourceArtifact: { metadata: unknown } | null;
}) {
  return artifactDescription(candidate.sourceArtifact?.metadata)
    ?? boundedDescription(record(candidate.content)?.summary)
    ?? boundedDescription(candidate.changeSummary);
}

function declaredAssetKind(value: unknown) {
  const kinds: Record<string, true> = {
    document: true,
    form: true,
    page: true,
    file: true,
    data_table: true,
    structured_result: true,
  };
  return typeof value === "string" && value in kinds
    ? value as "document" | "form" | "page" | "file" | "data_table" | "structured_result"
    : null;
}

// Artifact classification intentionally keeps precedence across declared kind, MIME, extension, and artifact type explicit.
// eslint-disable-next-line complexity
function artifactKind(artifact: { type: string; uri: string; metadata: unknown }) {
  const metadata = record(artifact.metadata);
  const declared = declaredAssetKind(metadata?.assetKind);
  if (declared) return declared;
  const extension = artifact.uri.toLowerCase().split(".").at(-1);
  const mimeType = typeof metadata?.mimeType === "string" ? metadata.mimeType.toLowerCase() : "";
  if (extension === "csv" || mimeType === "text/csv") return "data_table" as const;
  if (artifact.type === "report" || extension === "md" || extension === "txt") return "document" as const;
  if (extension === "html" || extension === "htm") return "page" as const;
  return metadata?.formSchema ? "form" as const : "file" as const;
}

function stripHostActions(spec: UiDocument): UiDocument {
  return {
    ...spec,
    elements: Object.fromEntries(
      Object.entries(spec.elements).map(([key, element]) => {
        const { on: _on, ...readOnlyElement } = element as typeof element & { on?: unknown };
        if (!(readOnlyElement.type in chronaResultCatalog.data.components)) {
          throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Structured result component is not allowed in Goal Workbench: ${readOnlyElement.type}`);
        }
        const props = record(readOnlyElement.props);
        if (!props) return [key, readOnlyElement];
        const { sourceNodeId: _sourceNodeId, xChronaSourceNodeId: _sourceNodeIdExtension, taskId: _taskId, runId: _runId, nodeId: _nodeId, providerRunId: _providerRunId, ...safeProps } = props;
        return [key, { ...readOnlyElement, props: safeProps }];
      }),
    ),
  };
}

function artifactRef(artifact: {
  id: string;
  title: string;
  uri: string;
  metadata: unknown;
}): (StructuredResultArtifactRef & { sourceUri: string }) | null {
  if (!artifact.uri.startsWith("generated://")) return null;
  const metadata = record(artifact.metadata);
  return {
    ref: `GF${createHash("sha256").update(artifact.id).digest("hex").slice(0, 12).toUpperCase()}`,
    sourceUri: artifact.uri,
    title: artifact.title.slice(0, 240),
    mimeType: typeof metadata?.mimeType === "string" ? metadata.mimeType : null,
    size: typeof metadata?.size === "number" ? metadata.size : null,
    checksum: typeof metadata?.checksum === "string" ? metadata.checksum : null,
  };
}

function artifactIdForStructuredRef(
  ref: string,
  artifacts: Array<{ id: string; uri: string; metadata: unknown }>,
) {
  return artifacts.find((artifact) => artifactRef({
    ...artifact,
    title: "",
  })?.ref === ref)?.id ?? null;
}

function referencedArtifactIds(
  content: StructuredResultAssetContent,
  artifacts: Array<{ id: string; uri: string; metadata: unknown }>,
) {
  const refs = new Set<string>();
  for (const element of Object.values(content.spec.elements)) {
    if (
      element.type !== "FileRef" &&
      element.type !== "FileView" &&
      element.type !== "ResultDeliverable" &&
      element.type !== "Table"
    ) continue;
    const props = record(element.props);
    if (typeof props?.path === "string" && /^GF[0-9A-F]{12}$/.test(props.path)) {
      refs.add(props.path);
    }
  }
  return [...refs]
    .map((ref) => artifactIdForStructuredRef(ref, artifacts))
    .filter((id): id is string => id !== null);
}

function normalizedGeneratedUri(value: string) {
  if (value.startsWith("generated://")) return value;
  const root = path.resolve(getChronaGeneratedFilesDir());
  const absolute = path.resolve(value);
  return absolute.startsWith(`${root}${path.sep}`)
    ? `generated://${absolute.slice(root.length + 1).split(path.sep).join("/")}`
    : value;
}

function bindStructuredResultArtifacts(
  spec: UiDocument,
  artifacts: Array<StructuredResultArtifactRef & { sourceUri: string }>,
): UiDocument {
  const artifactByUri = Object.fromEntries(artifacts.map((artifact) => [artifact.sourceUri, artifact]));
  const artifactByRef = Object.fromEntries(
    artifacts.map((artifact) => [artifact.ref.replace(/^GF/, "AF"), artifact]),
  );
  return {
    ...spec,
    elements: Object.fromEntries(
      Object.entries(spec.elements).map(([key, element]) => {
        const props = record(element.props) ?? {};
        const isFileComponent =
          element.type === "FileRef" ||
          element.type === "FileView" ||
          element.type === "ResultDeliverable" ||
          element.type === "Table";
        if (!isFileComponent) return [key, element];
        const source =
          typeof props.artifactRef === "string"
            ? props.artifactRef
            : typeof props.path === "string"
              ? props.path
              : typeof props.uri === "string"
                ? props.uri
                : null;
        const artifact = source
          ? artifactByUri[normalizedGeneratedUri(source)] ?? artifactByRef[source]
          : undefined;
        const { path: _path, uri: _uri, downloadHref: _downloadHref, accessTaskId: _accessTaskId, accessRequestedPath: _accessRequestedPath, previewError: _previewError, ...safeProps } = props;
        return [key, {
          ...element,
          props: {
            ...safeProps,
            path: artifact?.ref ?? "Unavailable file",
            displayPath: artifact?.title ?? safeProps.displayPath ?? "Unavailable file",
            ...(artifact ? {} : { previewError: "not_found" }),
          },
        }];
      }),
    ),
  };
}

function sanitizeStructuredSummary(summary: string, taskId: string) {
  const generatedRoot = path.resolve(getChronaGeneratedFilesDir());
  return summary
    .split("\n")
    .filter((line) => !line.includes(taskId) && !line.includes(generatedRoot) && !line.includes("generated://"))
    .join("\n")
    .slice(0, 12_000);
}

async function buildStructuredResultContent(input: {
  spec: unknown;
  summary: string;
  taskId: string;
  artifacts: Array<{ id: string; title: string; uri: string; metadata: unknown }>;
}): Promise<StructuredResultAssetContent> {
  const validation = validateChronaSpec(input.spec);
  if (!validation.ok) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      `Accepted result is not a valid Chrona structured result: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
    );
  }
  const artifacts = input.artifacts
    .map(artifactRef)
    .filter((artifact): artifact is StructuredResultArtifactRef & { sourceUri: string } => artifact !== null);
  const readOnlySpec = bindStructuredResultArtifacts(
    stripHostActions(validation.spec as UiDocument),
    artifacts,
  );
  return {
    format: STRUCTURED_RESULT_FORMAT,
    schemaVersion: STRUCTURED_RESULT_SCHEMA_VERSION,
    catalogVersion: CATALOG_VERSION,
    summary: sanitizeStructuredSummary(input.summary, input.taskId),
    spec: readOnlySpec,
    artifactRefs: artifacts.map(({ sourceUri: _sourceUri, ...artifact }) => artifact),
  };
}

async function linkedAssetsForStructuredResult(asset: {
  workspaceId: string;
  goalId: string;
  versions: Array<{ content: unknown }>;
  sourceArtifact: { taskId: string; runId: string };
}) {
  const content = asset.versions[0]?.content;
  if (!isStructuredResultAssetContent(content)) return [];
  const refs = new Set(content.artifactRefs.map((artifact) => artifact.ref));
  if (refs.size === 0) return [];
  const sourceArtifacts = await db.artifact.findMany({
    where: {
      workspaceId: asset.workspaceId,
      taskId: asset.sourceArtifact.taskId,
      runId: asset.sourceArtifact.runId,
      sourceGoalAssets: { some: { goalId: asset.goalId, archivedAt: null } },
    },
    include: {
      sourceGoalAssets: {
        where: { goalId: asset.goalId, archivedAt: null },
        select: { id: true },
        take: 1,
      },
    },
  });
  return sourceArtifacts.flatMap((artifact) => {
    const identity = artifactRef(artifact);
    const linkedAsset = artifact.sourceGoalAssets[0];
    return identity && linkedAsset && refs.has(identity.ref)
      ? [{ ref: identity.ref, assetId: linkedAsset.id }]
      : [];
  });
}


function artifactContent(artifact: { uri: string; contentPreview: string | null; metadata: unknown }) {
  const metadata = record(artifact.metadata);
  return metadata?.content ?? artifact.contentPreview ?? { uri: artifact.uri };
}

async function goalOrThrow(goalId: string, workspaceId?: string) {
  const goal = await db.goal.findFirst({ where: { id: goalId, ...(workspaceId ? { workspaceId } : {}) } });
  if (!goal) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal not found");
  return goal;
}

async function assetOrThrow(goalId: string, assetId: string, workspaceId?: string) {
  const asset = await db.goalAsset.findFirst({
    where: { id: assetId, goalId, ...(workspaceId ? { workspaceId } : {}) },
    include: {
      versions: { orderBy: { version: "desc" } },
      drafts: { where: { status: { in: ["Active", "Conflict"] } }, orderBy: { updatedAt: "desc" } },
      sourceArtifact: true,
      currentArtifact: true,
      submissions: { orderBy: { createdAt: "desc" }, take: 20 },
      jobs: { orderBy: { createdAt: "desc" }, take: 20 },
      reviews: { orderBy: { verifiedAt: "desc" }, take: 50 },
    },
  });
  if (!asset) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal asset not found");
  return asset;
}

async function assetUsageHistory(asset: Awaited<ReturnType<typeof assetOrThrow>>) {
  const ref = `GA${createHash("sha256").update(asset.id).digest("hex").slice(0, 12).toUpperCase()}`;
  const invocations = await db.toolInvocation.findMany({
    where: {
      toolName: "chrona.goal.results.read",
      status: "accepted",
      task: { goalId: asset.goalId, workspaceId: asset.workspaceId },
    },
    select: {
      inputPayload: true,
      completedAt: true,
      task: { select: { title: true, goalContext: true } },
    },
    orderBy: { completedAt: "desc" },
    take: 200,
  });
  return invocations.flatMap((invocation) => {
    const input = record(invocation.inputPayload);
    if (input?.ref !== ref || !invocation.task || !invocation.completedAt) return [];
    const snapshot = record(invocation.task.goalContext);
    const assets = Array.isArray(snapshot?.assets) ? snapshot.assets : [];
    const frozen = assets.map(record).find((candidate) => candidate?.ref === ref);
    if (typeof frozen?.version !== "number") return [];
    return [{
      taskTitle: invocation.task.title,
      version: frozen.version,
      completedAt: invocation.completedAt.toISOString(),
    }];
  }).slice(0, 20);
}

async function assetReadModel(asset: Awaited<ReturnType<typeof assetOrThrow>>) {
  return {
    ...asset,
    usageHistory: await assetUsageHistory(asset),
    linkedAssets: await linkedAssetsForStructuredResult(asset),
    archivedAt: asset.archivedAt?.toISOString() ?? null,
    lastOpenedAt: asset.lastOpenedAt?.toISOString() ?? null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    versions: asset.versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() })),
    reviews: asset.reviews.map((review) => ({ ...review, verifiedAt: review.verifiedAt.toISOString(), nextReviewAt: review.nextReviewAt?.toISOString() ?? null, createdAt: review.createdAt.toISOString() })),
    drafts: asset.drafts.map((draft) => ({ ...draft, createdAt: draft.createdAt.toISOString(), updatedAt: draft.updatedAt.toISOString() })),
    submissions: asset.submissions.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    jobs: asset.jobs.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
  };
}

export async function ensureAssetVersion(assetId: string) {
  const asset = await db.goalAsset.findUnique({ where: { id: assetId }, include: { sourceArtifact: true, versions: true } });
  if (!asset) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal asset not found");
  if (asset.versions.length > 0) return asset.versions.sort((a, b) => b.version - a.version)[0]!;
  const content = artifactContent(asset.sourceArtifact);
  return db.goalAssetVersion.create({
    data: {
      workspaceId: asset.workspaceId,
      goalId: asset.goalId,
      assetId: asset.id,
      artifactId: asset.sourceArtifactId,
      version: 1,
      source: "inbox",
      content: content as Prisma.InputJsonValue,
      contentHash: hash(content),
      mimeType: record(asset.sourceArtifact.metadata)?.mimeType as string | undefined,
      originalFilename: record(asset.sourceArtifact.metadata)?.filename as string | undefined,
      sourceTaskId: asset.sourceArtifact.taskId,
      sourceRunId: asset.sourceArtifact.runId,
      sourceResultId: asset.sourceArtifact.runId,
      authorType: "system",
      changeSummary: "Promoted immutable Task artifact",
    },
  });
}

export async function listGoalAssets(input: {
  goalId: string;
  workspaceId: string;
  query?: string;
  kind?: "document" | "form" | "page" | "file" | "data_table" | "structured_result";
  sourceTaskId?: string;
  state: "active" | "draft" | "running" | "failed" | "archived";
  sort: "updated_desc" | "updated_asc" | "name_asc";
}) {
  await goalOrThrow(input.goalId, input.workspaceId);
  const assets = await db.goalAsset.findMany({
    where: {
      goalId: input.goalId,
      workspaceId: input.workspaceId,
      ...(input.query ? { label: { contains: input.query } } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.sourceTaskId ? { sourceArtifact: { taskId: input.sourceTaskId } } : {}),
      ...(input.state === "archived" ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(input.state === "draft" ? { drafts: { some: { status: { in: ["Active", "Conflict"] } } } } : {}),
      ...(input.state === "running" ? { jobs: { some: { status: { in: ["Queued", "Processing"] } } } } : {}),
      ...(input.state === "failed" ? { jobs: { some: { status: "Failed" } } } : {}),
    },
    orderBy: input.sort === "name_asc" ? { label: "asc" } : { updatedAt: input.sort === "updated_asc" ? "asc" : "desc" },
    include: {
      sourceArtifact: true,
      currentArtifact: true,
      versions: { orderBy: { version: "desc" } },
      drafts: { where: { status: { in: ["Active", "Conflict"] } }, orderBy: { updatedAt: "desc" } },
      jobs: { orderBy: { createdAt: "desc" }, take: 5 },
      submissions: { orderBy: { createdAt: "desc" }, take: 5 },
      reviews: { orderBy: { verifiedAt: "desc" }, take: 50 },
    },
  });
  for (const asset of assets) if (asset.versions.length === 0) await ensureAssetVersion(asset.id);
  const hydrated = await Promise.all(assets.map((asset) => assetOrThrow(input.goalId, asset.id, input.workspaceId)));
  const readModels = await Promise.all(hydrated.map(assetReadModel));
  const recentIds = new Set(
    hydrated
      .filter((asset) => asset.lastOpenedAt)
      .sort((a, b) => (b.lastOpenedAt?.getTime() ?? 0) - (a.lastOpenedAt?.getTime() ?? 0))
      .slice(0, 6)
      .map((asset) => asset.id),
  );
  return {
    assets: readModels,
    recent: readModels.filter((asset) => recentIds.has(asset.id)),
  };
}

export async function getGoalAsset(input: { goalId: string; assetId: string }) {
  await ensureAssetVersion(input.assetId);
  await db.goalAsset.update({ where: { id: input.assetId }, data: { lastOpenedAt: new Date() } });
  return assetReadModel(await assetOrThrow(input.goalId, input.assetId));
}

export async function renameGoalAsset(input: {
  goalId: string;
  assetId: string;
  label: string;
  description?: string | null;
}) {
  await assetOrThrow(input.goalId, input.assetId);
  await db.goalAsset.update({
    where: { id: input.assetId },
    data: {
      label: input.label,
      ...(input.description !== undefined
        ? { description: input.description || null }
        : {}),
    },
  });
  return getGoalAsset(input);
}

export async function saveGoalAssetDraft(input: { goalId: string; assetId: string; command: SaveGoalAssetDraftRequest }) {
  const asset = await assetOrThrow(input.goalId, input.assetId, input.command.workspaceId);
  await ensureAssetVersion(asset.id);
  const base = await db.goalAssetVersion.findFirst({ where: { id: input.command.baseVersionId, assetId: asset.id } });
  if (!base) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Draft base version does not belong to this asset");
  const existing = await db.goalAssetDraft.findFirst({ where: { assetId: asset.id, authorType: input.command.authorType, status: "Active" } });
  const draft = existing
    ? await db.goalAssetDraft.update({ where: { id: existing.id }, data: { baseVersionId: base.id, content: input.command.content as Prisma.InputJsonValue, contentHash: hash(input.command.content) } })
    : await db.goalAssetDraft.create({ data: { workspaceId: asset.workspaceId, goalId: asset.goalId, assetId: asset.id, baseVersionId: base.id, content: input.command.content as Prisma.InputJsonValue, contentHash: hash(input.command.content), authorType: input.command.authorType, authorId: "server-action" } });
  return draft;
}

export async function submitGoalAssetDraft(input: { goalId: string; assetId: string; command: SubmitGoalAssetDraftRequest }) {
  const asset = await assetOrThrow(input.goalId, input.assetId, input.command.workspaceId);
  const draft = await db.goalAssetDraft.findFirst({ where: { id: input.command.draftId, assetId: asset.id, status: "Active" }, include: { baseVersion: true } });
  if (!draft) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Active draft not found");
  const current = asset.versions[0] ?? await ensureAssetVersion(asset.id);
  if (current.id !== draft.baseVersionId) {
    await db.goalAssetDraft.update({ where: { id: draft.id }, data: { status: "Conflict", conflictVersionId: current.id } });
    throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "The formal asset changed after this draft started");
  }
  return db.$transaction(async (tx) => {
    const latest = await tx.goalAssetVersion.findFirst({ where: { assetId: asset.id }, orderBy: { version: "desc" } });
    if (latest?.id !== draft.baseVersionId) {
      await tx.goalAssetDraft.update({ where: { id: draft.id }, data: { status: "Conflict", conflictVersionId: latest?.id } });
      throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "The formal asset changed after this draft started");
    }
    const version = await tx.goalAssetVersion.create({
      data: { workspaceId: asset.workspaceId, goalId: asset.goalId, assetId: asset.id, version: latest.version + 1, parentVersionId: latest.id, source: draft.authorType === "ai_task" ? "ai_task" : "manual", content: draft.content as Prisma.InputJsonValue, contentHash: draft.contentHash, changeSummary: input.command.changeSummary, authorType: draft.authorType, authorId: draft.authorId },
    });
    await tx.goalAssetDraft.update({ where: { id: draft.id }, data: { status: "Submitted" } });
    await tx.goalAsset.update({ where: { id: asset.id }, data: { status: "Approved" } });
    return version;
  });
}

export async function discardGoalAssetDraft(input: { goalId: string; assetId: string; workspaceId: string; draftId: string }) {
  const asset = await assetOrThrow(input.goalId, input.assetId, input.workspaceId);
  const draft = await db.goalAssetDraft.findFirst({ where: { id: input.draftId, assetId: asset.id, status: "Active" } });
  if (!draft) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Active draft not found");
  return db.goalAssetDraft.update({ where: { id: draft.id }, data: { status: "Discarded" } });
}

export async function restoreGoalAssetVersion(input: { goalId: string; assetId: string; versionId: string; workspaceId: string; changeSummary: string }) {
  const asset = await assetOrThrow(input.goalId, input.assetId, input.workspaceId);
  const source = await db.goalAssetVersion.findFirst({ where: { id: input.versionId, assetId: asset.id } });
  if (!source) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Version not found");
  const current = asset.versions[0] ?? await ensureAssetVersion(asset.id);
  return db.goalAssetVersion.create({ data: { workspaceId: asset.workspaceId, goalId: asset.goalId, assetId: asset.id, version: current.version + 1, parentVersionId: current.id, source: "restored", content: source.content as Prisma.InputJsonValue, contentHash: source.contentHash, mimeType: source.mimeType, originalFilename: source.originalFilename, changeSummary: input.changeSummary, selector: { restoredFromVersionId: source.id }, authorType: "user", authorId: "server-action" } });
}

export async function archiveGoalAsset(input: { goalId: string; assetId: string; workspaceId: string; action: "archive" | "restore" }) {
  await assetOrThrow(input.goalId, input.assetId, input.workspaceId);
  return db.goalAsset.update({ where: { id: input.assetId }, data: { archivedAt: input.action === "archive" ? new Date() : null, status: input.action === "archive" ? "Archived" : "Approved" } });
}

interface CandidateGoal {
  id: string;
  workspaceId: string;
}

interface CandidateTask {
  id: string;
  title: string;
}

async function upsertInboxCandidate(input: {
  goal: CandidateGoal;
  task: CandidateTask;
  runId: string;
  artifact: { id: string | null; title: string; type: string; uri: string; contentPreview: string | null; metadata: unknown };
}) {
  const kind = artifactKind(input.artifact);
  const content = artifactContent(input.artifact);
  const matches = await db.goalAsset.findMany({ where: { goalId: input.goal.id, kind, archivedAt: null }, take: 3, orderBy: { updatedAt: "desc" } });
  const normalizedTitle = input.artifact.title.toLowerCase();
  const target = matches.find((candidate) => normalizedTitle.includes(candidate.label.toLowerCase()) || candidate.label.toLowerCase().includes(normalizedTitle));
  const appendVersion = Boolean(target);
  const groupKey = input.artifact.id ?? `result:${input.runId}`;
  await db.goalInboxCandidate.upsert({
    where: { goalId_sourceRunId_groupKey: { goalId: input.goal.id, sourceRunId: input.runId, groupKey } },
    create: { workspaceId: input.goal.workspaceId, goalId: input.goal.id, sourceTaskId: input.task.id, sourceRunId: input.runId, sourceArtifactId: input.artifact.id, groupKey, kind, label: input.artifact.title, proposedAction: appendVersion ? "append_version" : "create_asset", proposedTargetAssetId: appendVersion ? target?.id : null, reason: target ? "rule_based_name_match" : "no_rule_based_name_match", changeSummary: `Candidate derived from accepted result “${input.task.title}”`, confidence: target ? 1 : 0, selector: input.artifact.id ? { artifactId: input.artifact.id } : { acceptedResult: true }, content: content as Prisma.InputJsonValue, contentHash: hash(content) },
    update: {},
  });
}

async function upsertStructuredResultCandidate(input: {
  goal: CandidateGoal;
  task: CandidateTask;
  runId: string;
  sourceRevision: number;
  content: StructuredResultAssetContent;
}) {
  const matches = await db.goalAsset.findMany({
    where: { goalId: input.goal.id, kind: "structured_result", archivedAt: null },
    take: 3,
    orderBy: { updatedAt: "desc" },
  });
  const normalizedTitle = input.task.title.toLowerCase();
  const target = matches.find((candidate) => normalizedTitle.includes(candidate.label.toLowerCase()) || candidate.label.toLowerCase().includes(normalizedTitle));
  const groupKey = `structured-result:${input.sourceRevision}`;
  await db.goalInboxCandidate.upsert({
    where: { goalId_sourceRunId_groupKey: { goalId: input.goal.id, sourceRunId: input.runId, groupKey } },
    create: {
      workspaceId: input.goal.workspaceId,
      goalId: input.goal.id,
      sourceTaskId: input.task.id,
      sourceRunId: input.runId,
      sourceArtifactId: null,
      groupKey,
      kind: "structured_result",
      label: input.task.title,
      proposedAction: target ? "append_version" : "create_asset",
      proposedTargetAssetId: target?.id,
      reason: target ? "rule_based_name_match" : "no_rule_based_name_match",
      confidence: target ? 1 : 0,
      changeSummary: `Structured result derived from accepted result “${input.task.title}”`,
      selector: { acceptedResult: true, format: STRUCTURED_RESULT_FORMAT },
      content: input.content as unknown as Prisma.InputJsonValue,
      contentHash: hash(input.content),
    },
    update: {
      label: input.task.title,
      proposedAction: target ? "append_version" : "create_asset",
      proposedTargetAssetId: target?.id ?? null,
      reason: target ? "rule_based_name_match" : "no_rule_based_name_match",
      confidence: target ? 1 : 0,
      changeSummary: `Structured result derived from accepted result “${input.task.title}”`,
      selector: { acceptedResult: true, format: STRUCTURED_RESULT_FORMAT },
      content: input.content as unknown as Prisma.InputJsonValue,
      contentHash: hash(input.content),
      status: "Pending",
      resolvedAt: null,
    },
  });
}

export async function splitAcceptedResultIntoCandidates(input: { goalId: string; taskId: string; runId: string }) {
  const goal = await goalOrThrow(input.goalId);
  const task = await db.task.findFirst({ where: { id: input.taskId, goalId: goal.id }, include: { runs: { where: { id: input.runId }, include: { artifacts: true } } } });
  if (!task) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Goal task not found");
  const acceptance = await db.event.findFirst({ where: { taskId: task.id, runId: input.runId, eventType: "task.result_accepted" } });
  if (!acceptance) throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Only accepted results enter the Workbench Inbox");
  const run = task.runs[0];
  if (!run) throw new EngineError(ENGINE_ERROR_CODES.INVALID_TASK_STATE, "Accepted run is unavailable");
  const acceptedResult = await getAcceptedResultContext(task.id);
  const resultArtifacts = run.artifacts.filter((artifact) =>
    record(artifact.metadata)?.derivedFromAcceptedResult !== true
  );
  if (acceptedResult.spec) {
    const artifacts = await db.artifact.findMany({
      where: { taskId: task.id, runId: run.id },
      select: { id: true, title: true, uri: true, metadata: true },
    });
    const planEvent = await db.event.findFirst({
      where: { taskId: task.id, runId: run.id, planId: { not: null } },
      orderBy: { ingestSequence: "desc" },
      select: { planId: true },
    });
    const planRun = planEvent?.planId
      ? await db.taskPlanRun.findFirst({
          where: { taskId: task.id, planId: planEvent.planId },
          orderBy: { updatedAt: "desc" },
          select: { planRun: true },
        })
      : null;
    const planRunEnvelope = record(planRun?.planRun);
    const mutableGraph = record(planRunEnvelope?.mutableGraph);
    const planOutput = record(mutableGraph?.planOutput);
    const finalizedResult = record(planOutput?.finalizedResult);
    const sourceRevision = typeof finalizedResult?.sourceRevision === "number"
      ? finalizedResult.sourceRevision
      : 0;
    const content = await buildStructuredResultContent({
      spec: acceptedResult.spec,
      summary: acceptedResult.summary,
      taskId: task.id,
      artifacts,
    });
    await upsertStructuredResultCandidate({
      goal,
      task,
      runId: run.id,
      sourceRevision,
      content,
    });
    const referencedIds = new Set(referencedArtifactIds(content, artifacts));
    await Promise.all(
      resultArtifacts
        .filter((artifact) => referencedIds.has(artifact.id))
        .map((artifact) => upsertInboxCandidate({ goal, task, runId: run.id, artifact })),
    );
  } else {
    const candidates = resultArtifacts.length > 0
      ? resultArtifacts
      : [{ id: null, title: task.title, type: "summary", uri: "accepted-result", contentPreview: acceptedResult.summary, metadata: null }];
    await Promise.all(candidates.map((artifact) => upsertInboxCandidate({ goal, task, runId: run.id, artifact })));
  }
  return listGoalInbox({ goalId: goal.id });
}

export async function listGoalInbox(input: { goalId: string }) {
  await goalOrThrow(input.goalId);
  const candidates = await db.goalInboxCandidate.findMany({
    where: { goalId: input.goalId, status: "Pending" },
    orderBy: [{ sourceRunId: "desc" }, { createdAt: "asc" }],
    include: {
      sourceTask: true,
      sourceArtifact: true,
      proposedTargetAsset: true,
      ownershipProposals: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { sourceTask: { select: { id: true, title: true } }, targetAsset: { select: { id: true, label: true } } },
      },
    },
  });
  return {
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      sourceTaskId: candidate.sourceTaskId,
      sourceRunId: candidate.sourceRunId,
      kind: candidate.kind,
      label: candidate.label,
      proposedAction: candidate.proposedAction,
      proposedTargetAssetId: candidate.proposedTargetAssetId,
      content: candidate.content,
      reason: candidate.reason,
      changeSummary: candidate.changeSummary,
      confidence: candidate.confidence,
      sourceArtifact: candidate.sourceArtifact
        ? {
            id: candidate.sourceArtifact.id,
            title: candidate.sourceArtifact.title,
            uri: candidate.sourceArtifact.uri,
            contentPreview: candidate.sourceArtifact.contentPreview,
          }
        : null,
      sourceTask: { title: candidate.sourceTask.title },
      proposedTargetAsset: candidate.proposedTargetAsset
        ? { id: candidate.proposedTargetAsset.id, label: candidate.proposedTargetAsset.label }
        : null,
      ownershipProposals: candidate.ownershipProposals.map((proposal) => ({
        id: proposal.id,
        status: proposal.status,
        sourceTaskId: proposal.sourceTaskId,
        sourceRunId: proposal.sourceRunId,
        result: proposal.result,
        sourceTask: proposal.sourceTask,
        targetAsset: proposal.targetAsset,
      })),
    })),
  };
}

async function createLinkedFileAssets(
  tx: Prisma.TransactionClient,
  candidate: {
    workspaceId: string;
    goalId: string;
    sourceTaskId: string;
    sourceRunId: string;
    content: unknown;
  },
) {
  if (!isStructuredResultAssetContent(candidate.content)) return [];
  const refs = new Set(candidate.content.artifactRefs.map((artifact) => artifact.ref));
  if (refs.size === 0) return [];
  const artifacts = await tx.artifact.findMany({
    where: {
      workspaceId: candidate.workspaceId,
      taskId: candidate.sourceTaskId,
      runId: candidate.sourceRunId,
    },
  });
  const linked: Array<{ ref: string; assetId: string }> = [];
  for (const artifact of artifacts) {
    const artifactIdentity = artifactRef(artifact);
    if (!artifactIdentity || !refs.has(artifactIdentity.ref)) continue;
    const content = artifactContent(artifact);
    const existing = await tx.goalAsset.findUnique({
      where: {
        goalId_sourceArtifactId: {
          goalId: candidate.goalId,
          sourceArtifactId: artifact.id,
        },
      },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (existing) {
      linked.push({ ref: artifactIdentity.ref, assetId: existing.id });
      continue;
    }
    const asset = await tx.goalAsset.create({
      data: {
        workspaceId: candidate.workspaceId,
        goalId: candidate.goalId,
        sourceArtifactId: artifact.id,
        currentArtifactId: artifact.id,
        kind: artifactKind(artifact),
        role: "working_document",
        status: "Approved",
        label: artifact.title,
        description: artifactDescription(artifact.metadata),
      },
    });
    const metadata = record(artifact.metadata);
    await tx.goalAssetVersion.create({
      data: {
        workspaceId: candidate.workspaceId,
        goalId: candidate.goalId,
        assetId: asset.id,
        artifactId: artifact.id,
        version: 1,
        source: "inbox",
        content: content as Prisma.InputJsonValue,
        contentHash: hash(content),
        mimeType: typeof metadata?.mimeType === "string" ? metadata.mimeType : undefined,
        originalFilename: typeof metadata?.filename === "string" ? metadata.filename : artifact.title,
        sourceTaskId: candidate.sourceTaskId,
        sourceRunId: candidate.sourceRunId,
        sourceResultId: candidate.sourceRunId,
        selector: { structuredResultRef: artifactIdentity.ref },
        authorType: "user",
        authorId: "server-action",
        changeSummary: "Promoted file referenced by accepted structured result",
      },
    });
    linked.push({ ref: artifactIdentity.ref, assetId: asset.id });
  }
  return linked;
}

export async function resolveGoalInboxCandidate(input: { goalId: string; candidateId: string; command: ResolveGoalInboxCandidateRequest }) {
  const candidate = await db.goalInboxCandidate.findFirst({ where: { id: input.candidateId, goalId: input.goalId, workspaceId: input.command.workspaceId, status: "Pending" }, include: { sourceArtifact: true } });
  if (!candidate) throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Inbox candidate not found");
  if (input.command.action === "reject") {
    return db.goalInboxCandidate.update({ where: { id: candidate.id }, data: { status: "Rejected", resolvedAt: new Date() } });
  }
  const command = input.command;
  return db.$transaction(async (tx) => {
    let assetId: string;
    if (command.action === "create_asset") {
      const sourceArtifact = candidate.sourceArtifactId
        ? null
        : await tx.artifact.create({
            data: {
              workspaceId: candidate.workspaceId,
              taskId: candidate.sourceTaskId,
              runId: candidate.sourceRunId,
              type: candidate.kind === "structured_result" ? "report" : "file",
              title: command.label,
              uri: `generated://goals/${candidate.goalId}/inbox/${candidate.id}`,
              contentPreview: isStructuredResultAssetContent(candidate.content)
                ? candidate.content.summary.slice(0, 2_000)
                : typeof candidate.content === "string"
                  ? candidate.content.slice(0, 2_000)
                  : JSON.stringify(candidate.content).slice(0, 2_000),
              metadata: {
                derivedFromAcceptedResult: true,
                inboxCandidateId: candidate.id,
                assetKind: candidate.kind,
                ...(isStructuredResultAssetContent(candidate.content) ? { format: STRUCTURED_RESULT_FORMAT } : {}),
              },
            },
          });
      const sourceArtifactId = candidate.sourceArtifactId ?? sourceArtifact?.id;
      if (!sourceArtifactId) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Inbox candidate source artifact is unavailable");
      const existing = await tx.goalAsset.findUnique({
        where: {
          goalId_sourceArtifactId: {
            goalId: candidate.goalId,
            sourceArtifactId,
          },
        },
      });
      if (existing) {
        if (existing.kind !== candidate.kind) {
          throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Existing linked asset type does not match the Inbox candidate");
        }
        assetId = existing.id;
      } else {
        const asset = await tx.goalAsset.create({ data: { workspaceId: candidate.workspaceId, goalId: candidate.goalId, sourceArtifactId, currentArtifactId: sourceArtifactId, kind: candidate.kind, role: "working_document", status: "Approved", label: command.label, description: candidateDescription(candidate) } });
        assetId = asset.id;
        await tx.goalAssetVersion.create({ data: { workspaceId: candidate.workspaceId, goalId: candidate.goalId, assetId: asset.id, artifactId: sourceArtifactId, version: 1, source: "inbox", content: candidate.content as Prisma.InputJsonValue, contentHash: candidate.contentHash, mimeType: candidate.kind === "structured_result" ? "application/vnd.chrona.structured-result+json" : record(candidate.sourceArtifact?.metadata)?.mimeType as string | undefined, originalFilename: record(candidate.sourceArtifact?.metadata)?.filename as string | undefined, sourceTaskId: candidate.sourceTaskId, sourceRunId: candidate.sourceRunId, sourceResultId: candidate.sourceRunId, selector: candidate.selector as Prisma.InputJsonValue, authorType: "user", authorId: "server-action", changeSummary: candidate.changeSummary } });
      }
    } else {
      const target = await tx.goalAsset.findFirst({ where: { id: command.targetAssetId, goalId: candidate.goalId, workspaceId: candidate.workspaceId, archivedAt: null } });
      if (!target) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Target asset does not belong to this Goal");
      if (target.kind !== candidate.kind) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Inbox candidate type does not match the target asset");
      const current = await tx.goalAssetVersion.findFirst({ where: { assetId: target.id }, orderBy: { version: "desc" } });
      if (!current) throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Target asset has no formal version");
      if (current.id !== command.baseVersionId) throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Target asset changed after the Inbox destination was selected");
      await tx.goalAssetVersion.create({ data: { workspaceId: candidate.workspaceId, goalId: candidate.goalId, assetId: target.id, artifactId: candidate.sourceArtifactId, version: current.version + 1, parentVersionId: current.id, source: "inbox", content: candidate.content as Prisma.InputJsonValue, contentHash: candidate.contentHash, mimeType: candidate.kind === "structured_result" ? "application/vnd.chrona.structured-result+json" : record(candidate.sourceArtifact?.metadata)?.mimeType as string | undefined, originalFilename: record(candidate.sourceArtifact?.metadata)?.filename as string | undefined, sourceTaskId: candidate.sourceTaskId, sourceRunId: candidate.sourceRunId, sourceResultId: candidate.sourceRunId, selector: candidate.selector as Prisma.InputJsonValue, authorType: "user", authorId: "server-action", changeSummary: command.changeSummary } });
      assetId = target.id;
    }
    const linkedAssets = await createLinkedFileAssets(tx, candidate);
    const resolved = await tx.goalInboxCandidate.updateMany({ where: { id: candidate.id, status: "Pending" }, data: { status: "Accepted", resolvedAt: new Date() } });
    if (resolved.count !== 1) throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Inbox candidate was already resolved");
    return { assetId, linkedAssets };
  });
}

function formFields(value: unknown) {
  const fields = record(value)?.fields;
  if (!Array.isArray(fields)) return null;
  const normalized: Array<{ id: string; type: "text" | "textarea" | "checkbox"; required: boolean }> = [];
  for (const item of fields) {
    const field = record(item);
    const type = field?.type;
    if (typeof field?.id !== "string" || (type !== "text" && type !== "textarea" && type !== "checkbox")) return null;
    normalized.push({ id: field.id, type, required: field.required === true });
  }
  return normalized.length > 0 ? normalized : null;
}

function validateFormSubmission(definition: unknown, content: Record<string, unknown>) {
  const fields = formFields(definition);
  if (!fields) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Form version has an invalid definition");
  const allowed = new Set(fields.map((field) => field.id));
  if (Object.keys(content).some((key) => !allowed.has(key))) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Form submission contains unknown fields");
  for (const field of fields) {
    const value = content[field.id];
    if (field.required && (field.type === "checkbox" ? value !== true : typeof value !== "string" || value.trim().length === 0)) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Required Form field is missing: ${field.id}`);
    if (value !== undefined && (field.type === "checkbox" ? typeof value !== "boolean" : typeof value !== "string")) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Form field has an invalid value: ${field.id}`);
  }
}

export async function createGoalFormSubmission(input: { goalId: string; assetId: string; command: CreateGoalFormSubmissionRequest }) {
  const asset = await assetOrThrow(input.goalId, input.assetId, input.command.workspaceId);
  if (asset.kind !== "form") throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Only Form assets accept submissions");
  const version = await db.goalAssetVersion.findFirst({ where: { id: input.command.versionId, assetId: asset.id } });
  if (!version) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Form version not found");
  validateFormSubmission(version.content, input.command.content);
  return db.goalFormSubmission.create({ data: { workspaceId: asset.workspaceId, goalId: asset.goalId, assetId: asset.id, versionId: version.id, content: input.command.content as Prisma.InputJsonValue, contentHash: hash(input.command.content) } });
}

function exportExtension(assetKind: string, format: string | undefined) {
  const requested = format?.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!requested || requested === "source") return assetKind === "document" ? "md" : assetKind === "page" ? "html" : "json";
  const supported = assetKind === "document"
    ? ["md", "txt", "pdf"]
    : assetKind === "page"
      ? ["html", "pdf"]
      : assetKind === "structured_result"
        ? ["md", "pdf", "json"]
        : ["json"];
  if (!supported.includes(requested)) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, `Unsupported ${assetKind} export format: ${requested}`);
  return requested;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function exportBody(assetKind: string, content: unknown, extension: string) {
  if (extension === "md") return goalAssetContentToMarkdown(assetKind, content);
  if (extension === "txt" || extension === "html") return typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return JSON.stringify(content, null, 2);
}

function pdfHtml(title: string, markdown: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font:15px/1.65 system-ui,sans-serif;color:#18181b}h1{font-size:26px}pre{white-space:pre-wrap;font:14px/1.65 ui-monospace,monospace}header{border-bottom:1px solid #ddd;margin-bottom:20px}</style></head><body><header><h1>${escapeHtml(title)}</h1></header><pre>${escapeHtml(markdown)}</pre></body></html>`;
}

function chromiumExecutable() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? process.env.CHROMIUM_PATH;
  if (explicit) return explicit;

  const browserRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(homedir(), ".cache", "ms-playwright"),
  ].filter((root): root is string => Boolean(root));
  for (const browserRoot of browserRoots) {
    if (!existsSync(browserRoot)) continue;
    const releases = readdirSync(browserRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));
    for (const release of releases) {
      for (const relativePath of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const candidate = path.join(browserRoot, release.name, relativePath);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return "chromium";
}

async function writePdf(outputPath: string, title: string, content: string) {
  const htmlPath = `${outputPath}.html`;
  await writeFile(htmlPath, pdfHtml(title, content), "utf8");
  try {
    await new Promise<void>((resolve, reject) => {
      const process = spawn(chromiumExecutable(), ["--headless", "--no-sandbox", "--disable-gpu", `--print-to-pdf=${outputPath}`, `file://${htmlPath}`], { stdio: "ignore" });
      const timeout = setTimeout(() => {
        process.kill("SIGKILL");
        reject(new Error("PDF renderer timed out"));
      }, 30_000);
      process.once("error", (cause) => { clearTimeout(timeout); reject(cause); });
      process.once("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(`PDF renderer exited with code ${code ?? "unknown"}`));
      });
    });
  } finally {
    await Bun.file(htmlPath).delete();
  }
}

export async function createGoalAssetJob(input: { goalId: string; assetId: string; command: CreateGoalAssetJobRequest }) {
  const asset = await assetOrThrow(input.goalId, input.assetId, input.command.workspaceId);
  const version = await db.goalAssetVersion.findFirst({ where: { id: input.command.versionId, assetId: asset.id } });
  if (!version) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Asset version not found");
  const extension = exportExtension(asset.kind, input.command.format);
  const outputUri = input.command.kind === "export" ? `generated://goals/${asset.goalId}/assets/${asset.id}/versions/v${version.version}.${extension}` : null;
  const job = await db.goalAssetJob.create({ data: { workspaceId: asset.workspaceId, goalId: asset.goalId, assetId: asset.id, versionId: version.id, kind: input.command.kind, format: input.command.format, status: input.command.kind === "export" ? "Processing" : "Queued", outputUri } });
  if (input.command.kind !== "export") return job;
  try {
    const outputPath = path.join(getChronaGeneratedFilesDir(), "goals", asset.goalId, "assets", asset.id, "versions", `v${version.version}.${extension}`);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const body = exportBody(asset.kind, version.content, extension);
    if (extension === "pdf") await writePdf(outputPath, asset.label, goalAssetContentToMarkdown(asset.kind, version.content));
    else await writeFile(outputPath, body, "utf8");
    return db.goalAssetJob.update({ where: { id: job.id }, data: { status: "Completed" } });
  } catch (cause) {
    await db.goalAssetJob.update({ where: { id: job.id }, data: { status: "Failed", errorMessage: cause instanceof Error ? cause.message : String(cause) } });
    throw cause;
  }
}
export async function openGoalAssetFile(input: { goalId: string; assetId: string; versionId: string; mode: "source" | "export"; format?: string }) {
  const asset = await assetOrThrow(input.goalId, input.assetId);
  const version = await db.goalAssetVersion.findFirst({ where: { id: input.versionId, assetId: asset.id } });
  if (!version) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Asset version not found");

  if (input.mode === "source") {
    const extension = exportExtension(asset.kind, "source");
    const filename = version.originalFilename ?? `${asset.label}-v${version.version}.${extension}`;
    return { body: exportBody(asset.kind, version.content, extension), filename, mimeType: version.mimeType ?? (extension === "json" ? "application/json" : "text/plain; charset=utf-8") };
  }

  const job = await db.goalAssetJob.findFirst({ where: { assetId: asset.id, versionId: version.id, kind: "export", status: "Completed", outputUri: { not: null }, ...(input.format ? { format: input.format } : {}) }, orderBy: { createdAt: "desc" } });
  if (!job?.outputUri) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "No completed export exists for this version");
  const generatedPath = resolveGeneratedFileReference(job.outputUri);
  if (!generatedPath) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Export path is invalid");
  const file = Bun.file(generatedPath);
  if (!(await file.exists())) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Export file was not found");
  return { body: file, filename: path.basename(generatedPath), mimeType: file.type || "application/octet-stream" };
}

export async function openGoalStructuredArtifact(input: { goalId: string; assetId: string; versionId: string; artifactRef: string }) {
  const asset = await assetOrThrow(input.goalId, input.assetId);
  if (asset.kind !== "structured_result") throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Only structured results expose referenced artifacts");
  const version = await db.goalAssetVersion.findFirst({ where: { id: input.versionId, assetId: asset.id } });
  if (!version || !isStructuredResultAssetContent(version.content)) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Structured result version not found");
  const ref = version.content.artifactRefs.find((artifact) => artifact.ref === input.artifactRef);
  if (!ref || !version.sourceRunId || !version.sourceTaskId) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Structured result artifact not found");
  const artifacts = await db.artifact.findMany({ where: { taskId: version.sourceTaskId, runId: version.sourceRunId }, select: { id: true, title: true, uri: true, metadata: true } });
  const artifact = artifacts.find((candidate) => artifactRef(candidate)?.ref === ref.ref);
  if (!artifact) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Structured result artifact not found");
  const generatedPath = resolveGeneratedFileReference(artifact.uri);
  if (!generatedPath) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Structured result artifact path is invalid");
  const access = await requestResultFileAccess({ taskId: version.sourceTaskId, requestedPath: generatedPath });
  if (access.status !== "already_allowed") throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Structured result artifact path is invalid");
  const file = Bun.file(access.canonicalPath);
  if (!(await file.exists())) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Structured result artifact was not found");
  return { body: file, filename: path.basename(access.canonicalPath), mimeType: file.type || ref.mimeType || "application/octet-stream" };
}


export async function createGoalAssetReview(input: { goalId: string; assetId: string; command: CreateGoalAssetReviewRequest }) {
  const asset = await assetOrThrow(input.goalId, input.assetId, input.command.workspaceId);
  const version = await db.goalAssetVersion.findFirst({ where: { id: input.command.versionId, assetId: asset.id } });
  if (!version) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Asset version not found");
  const verifiedAt = new Date(input.command.verifiedAt);
  const nextReviewAt = input.command.nextReviewAt ? new Date(input.command.nextReviewAt) : null;
  if (Number.isNaN(verifiedAt.getTime()) || (nextReviewAt && Number.isNaN(nextReviewAt.getTime()))) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Review dates are invalid");
  }
  if (nextReviewAt && nextReviewAt <= verifiedAt) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Next review must be after verification");
  }
  return db.goalAssetReview.create({ data: { workspaceId: asset.workspaceId, goalId: asset.goalId, assetId: asset.id, versionId: version.id, verifiedAt, nextReviewAt, summary: input.command.summary || null, authorType: "user" } });
}

export async function createAssetUseTask(input: { goalId: string; assetId: string; command: CreateAssetUseTaskRequest }) {
  const asset = await assetOrThrow(input.goalId, input.assetId, input.command.workspaceId);
  const version = await db.goalAssetVersion.findFirst({ where: { id: input.command.versionId, assetId: asset.id } });
  if (!version) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Asset version not found");
  const description = `${input.command.instruction.trim()}\n\nUse the Goal asset “${asset.label}” (${goalAssetRef(asset.id)}) at captured version v${version.version}. Read it with chrona_goal_results_read when its full content is needed; do not assume the asset body is embedded in this Task description.`;
  return createTask({ workspaceId: asset.workspaceId, goalId: asset.goalId, title: input.command.title, description, priority: "Medium", autoPlanGeneration: false, autoExecute: false, goalContext: { expectedOutcome: input.command.expectedOutcome } });
}

export async function createAssetModificationTask(input: { goalId: string; assetId: string; command: CreateAssetModificationTaskRequest }) {
  const asset = await assetOrThrow(input.goalId, input.assetId, input.command.workspaceId);
  const version = await db.goalAssetVersion.findFirst({ where: { id: input.command.versionId, assetId: asset.id } });
  if (!version) throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Asset version not found");
  return createTask({
    workspaceId: asset.workspaceId,
    goalId: asset.goalId,
    title: `Modify ${asset.label}`,
    description: `${input.command.instruction.trim()}\n\nModify the Goal asset “${asset.label}” (${goalAssetRef(asset.id)}) at captured version v${version.version}. Read it with chrona_goal_results_read when its full content is needed. Produce the proposed replacement through the Goal Inbox; do not assume the asset body is embedded in this Task description.`,
    priority: "Medium",
    autoPlanGeneration: false,
    autoExecute: false,
    goalContext: {
      expectedOutcome: input.command.expectedOutcome,
    },
  });
}

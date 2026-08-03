/* eslint-disable complexity, @typescript-eslint/no-unnecessary-condition -- Result file access validates persisted artifact metadata defensively. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { basename, join } from "node:path";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import {
  resolveGeneratedFileReference,
  requestResultFileAccess,
} from "./result-file-access";
import { aiArtifactRef } from "../plan-execution/use-cases/register-generated-plan-output-artifacts";

function outputSpecFromPlanRun(value: unknown): {
  elements?: Record<string, { type?: unknown; props?: unknown }>;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const nestedPlanRun = record.planRun;
  if (nestedPlanRun && typeof nestedPlanRun === "object" && !Array.isArray(nestedPlanRun)) {
    const nestedSpec = outputSpecFromPlanRun(nestedPlanRun);
    if (nestedSpec) return nestedSpec;
  }
  const graph = record.mutableGraph;
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return null;
  const planOutput = (graph as Record<string, unknown>).planOutput;
  if (!planOutput || typeof planOutput !== "object" || Array.isArray(planOutput))
    return null;
  const finalizedResult = (planOutput as Record<string, unknown>).finalizedResult;
  if (!finalizedResult || typeof finalizedResult !== "object" || Array.isArray(finalizedResult)) {
    return null;
  }
  const spec = (finalizedResult as Record<string, unknown>).spec;
  return spec && typeof spec === "object" && !Array.isArray(spec)
    ? (spec as { elements?: Record<string, { type?: unknown; props?: unknown }> })
    : null;
}

function specReferencesFile(value: unknown, requestedIdentities: ReadonlySet<string>) {
  const spec = outputSpecFromPlanRun(value);
  return Object.values(spec?.elements ?? {}).some((element) => {
    if (
      element.type !== "FileRef" &&
      element.type !== "FileView" &&
      element.type !== "ResultDeliverable" &&
      element.type !== "WorkspaceArtifactItem" &&
      element.type !== "Table"
    ) return false;
    if (!element.props || typeof element.props !== "object" || Array.isArray(element.props))
      return false;
    const props = element.props as Record<string, unknown>;
    return [props.path, props.uri, props.artifactRef].some(
      (candidate) => typeof candidate === "string" && requestedIdentities.has(candidate),
    );
  });
}

async function snapshotVerifiedFile(input: {
  sourcePath: string;
  expectedChecksum: string;
  expectedSize: number;
  contentType: string;
}) {
  const source = await open(input.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  const tempRoot = await mkdtemp(join(tmpdir(), "chrona-result-file-"));
  const tempPath = join(tempRoot, "content");
  let destination;
  try {
    const initial = await source.stat();
    if (!initial.isFile()) throw new Error("Generated task result is not a regular file");
    destination = await open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    const checksum = createHash("sha256");
    for await (const chunk of source.createReadStream({ autoClose: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      checksum.update(bytes);
      await destination.write(bytes);
    }
    const completed = await source.stat();
    if (
      completed.dev !== initial.dev
      || completed.ino !== initial.ino
      || completed.size !== initial.size
      || completed.mtimeMs !== initial.mtimeMs
      || completed.ctimeMs !== initial.ctimeMs
      || initial.size !== input.expectedSize
      || checksum.digest("hex") !== input.expectedChecksum
    ) {
      throw new Error("Generated task result changed after registration");
    }
  } catch (cause) {
    await source.close().catch(() => undefined);
    if (destination) await destination.close().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      cause instanceof Error ? cause.message : "Generated task result could not be verified",
    );
  }
  await source.close();
  await destination?.close();

  let reader;
  let handle: FileHandle | undefined;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await handle?.close().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        handle = await open(tempPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        reader = handle.createReadStream({ autoClose: false })[Symbol.asyncIterator]();
      } catch (cause) {
        await cleanup();
        controller.error(cause);
      }
    },
    async pull(controller) {
      try {
        const next = await reader!.next();
        if (next.done) {
          await cleanup();
          controller.close();
          return;
        }
        controller.enqueue(Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value));
      } catch (cause) {
        await cleanup();
        controller.error(cause);
      }
    },
    async cancel() {
      await cleanup();
    },
  });
  return { stream, contentType: input.contentType, cleanup };
}

export async function openTaskResultFile(input: {
  taskId: string;
  requestedPath: string;
}) {
  const generatedPath = resolveGeneratedFileReference(input.requestedPath);
  if (!generatedPath) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Only generated task result files can be downloaded directly",
    );
  }

  const artifact = await db.artifact.findFirst({
    where: { taskId: input.taskId, uri: input.requestedPath, type: "file" },
    orderBy: { createdAt: "desc" },
    select: { id: true, runId: true, metadata: true },
  });
  if (!artifact) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "This file is not a registered task result Artifact",
    );
  }
  const metadata = artifact.metadata && typeof artifact.metadata === "object" && !Array.isArray(artifact.metadata)
    ? artifact.metadata as Record<string, unknown>
    : null;
  const expectedChecksum = metadata?.checksumAlgorithm === "sha256" && typeof metadata.checksum === "string"
    ? metadata.checksum
    : null;
  const expectedSize = typeof metadata?.size === "number" && Number.isSafeInteger(metadata.size) && metadata.size >= 0
    ? metadata.size
    : null;
  if (!expectedChecksum || expectedSize === null) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "Registered task result has no integrity metadata");
  }
  const planEvent = await db.event.findFirst({
    where: { taskId: input.taskId, runId: artifact.runId, planId: { not: null } },
    orderBy: { ingestSequence: "desc" },
    select: { planId: true },
  });
  const requestedIdentities = new Set([input.requestedPath, aiArtifactRef(artifact.id)]);
  const planRuns = planEvent?.planId
    ? await db.taskPlanRun.findMany({
        where: { taskId: input.taskId, planId: planEvent.planId },
        select: { planRun: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      })
    : [];
  if (!planRuns.some((run) => specReferencesFile(run.planRun, requestedIdentities))) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "This file is not referenced by the task result",
    );
  }

  const access = await requestResultFileAccess({ taskId: input.taskId, requestedPath: generatedPath });
  if (access.status !== "already_allowed") {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Generated task result file is not directly accessible",
    );
  }
  const contentType = typeof metadata?.mimeType === "string" ? metadata.mimeType : "application/octet-stream";
  const snapshot = await snapshotVerifiedFile({
    sourcePath: access.canonicalPath,
    expectedChecksum,
    expectedSize,
    contentType,
  });
  return { stream: snapshot.stream, contentType: snapshot.contentType, filename: basename(access.canonicalPath) };
}

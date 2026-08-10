/* eslint-disable max-lines-per-function, complexity -- Artifact registration validates all declarations before authoritative commit. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import type {
  AiArtifactRef,
  NodeDeliverable,
  NodeDeliverableDeclaration,
} from "@chrona/contracts/ai";
import type { Prisma } from "@/generated/prisma/client";
import { withPlanExecutionDurability } from "../persistence/scheduler-durability";
import { generatedFilesRoot, resolveGeneratedFileReference } from "../../tasks/result-file-access";
import { ENGINE_ERROR_CODES, EngineError } from "../../../errors";

const PREVIEW_BYTES = 64 * 1024;
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".csv"]);
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

function isWithinGeneratedRoot(path: string) {
  const root = resolve(generatedFilesRoot());
  return path === root || path.startsWith(`${root}${sep}`);
}

export function aiArtifactRef(artifactId: string): AiArtifactRef {
  return `AF${createHash("sha256")
    .update(artifactId)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase()}`;
}

async function inspectGeneratedFile(uri: string, runId: string) {
  const resolved = resolveGeneratedFileReference(uri);
  if (!resolved) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Deliverable URI must resolve inside the generated-files root.",
    );
  }
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(resolved);
  } catch {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      `Generated deliverable does not exist: ${uri}`,
    );
  }
  if (!isWithinGeneratedRoot(canonicalPath)) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Generated deliverable escapes the generated-files root.",
    );
  }

  let handle;
  try {
    handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Generated deliverable changed before it could be opened safely.",
    );
  }
  try {
    const fileStat = await handle.stat();
    const openedCanonicalPath = await realpath(canonicalPath);
    const openedPathStat = await stat(openedCanonicalPath);
    if (
      !fileStat.isFile()
      || !openedPathStat.isFile()
      || fileStat.dev !== openedPathStat.dev
      || fileStat.ino !== openedPathStat.ino
    ) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "Generated deliverable must remain the same regular file while it is inspected.",
      );
    }
    if (!isWithinGeneratedRoot(openedCanonicalPath)) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "Generated deliverable escapes the generated-files root.",
      );
    }

    const relativePath = relative(resolve(generatedFilesRoot()), openedCanonicalPath)
      .split(sep)
      .join("/");
    if (relativePath.split("/")[0] !== runId) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "Generated deliverable must be stored under its canonical Run scope.",
      );
    }

    const extension = extname(openedCanonicalPath).toLowerCase();
    const checksum = createHash("sha256");
    const previewChunks: Buffer[] = [];
    let previewSize = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      checksum.update(bytes);
      if (TEXT_EXTENSIONS.has(extension) && previewSize < PREVIEW_BYTES) {
        const preview = bytes.subarray(0, PREVIEW_BYTES - previewSize);
        previewChunks.push(preview);
        previewSize += preview.length;
      }
    }
    const completedStat = await handle.stat();
    if (
      completedStat.dev !== fileStat.dev
      || completedStat.ino !== fileStat.ino
      || completedStat.size !== fileStat.size
      || completedStat.mtimeMs !== fileStat.mtimeMs
      || completedStat.ctimeMs !== fileStat.ctimeMs
    ) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "Generated deliverable changed while it was inspected.",
      );
    }

    return {
      uri: `generated://${relativePath}`,
      checksum: checksum.digest("hex"),
      size: fileStat.size,
      mimeType: MIME_TYPES[extension] ?? "application/octet-stream",
      contentPreview: TEXT_EXTENSIONS.has(extension)
        ? Buffer.concat(previewChunks).toString("utf8")
        : null,
    };
  } finally {
    await handle.close();
  }
}

async function artifactFromRef(input: {
  workspaceId: string;
  taskId: string;
  runId: string;
  ref: AiArtifactRef;
}, client: Prisma.TransactionClient) {
  const artifacts = await client.artifact.findMany({
    where: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      runId: input.runId,
      type: "file",
    },
    select: { id: true },
  });
  const artifact = artifacts.find((candidate) => aiArtifactRef(candidate.id) === input.ref);
  if (!artifact) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      `Unknown artifact reference: ${input.ref}`,
    );
  }
  return artifact;
}

async function registerDeclaration(input: {
  workspaceId: string;
  taskId: string;
  runId: string;
  occurrenceId: string | null;
  sourceNodeId: string;
  declaration: NodeDeliverableDeclaration;
}, client: Prisma.TransactionClient): Promise<NodeDeliverable> {
  let artifactId: string;
  if (input.declaration.source.type === "existing_artifact") {
    artifactId = (
      await artifactFromRef({
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        runId: input.runId,
        ref: input.declaration.source.artifactRef,
      }, client)
    ).id;
  } else {
    const file = await inspectGeneratedFile(input.declaration.source.uri, input.runId);
    const registrationKey = createHash("sha256")
      .update(
        [
          input.workspaceId,
          input.taskId,
          input.runId,
          file.uri,
          file.checksum,
        ].join("\0"),
      )
      .digest("hex");
    const metadata = {
      registrationKey,
      checksumAlgorithm: "sha256",
      checksum: file.checksum,
      size: file.size,
      mimeType: file.mimeType,
      sourceNodeId: input.sourceNodeId,
      deliverableKey: input.declaration.deliverableKey,
    };
    const existing = await client.artifact.findFirst({
      where: {
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        runId: input.runId,
        uri: file.uri,
      },
      select: { id: true, metadata: true },
    });
    if (existing) {
      const existingMetadata = existing.metadata as Record<string, unknown> | null;
      if (existingMetadata?.checksum !== file.checksum) {
        throw new EngineError(
          ENGINE_ERROR_CODES.CONFLICT,
          `Generated deliverable path changed after registration: ${file.uri}`,
        );
      }
      artifactId = existing.id;
    } else {
      artifactId = (
        await client.artifact.create({
          data: {
            workspaceId: input.workspaceId,
            taskId: input.taskId,
            runId: input.runId,
            occurrenceId: input.occurrenceId,
            type: "file",
            title: input.declaration.title,
            uri: file.uri,
            contentPreview: file.contentPreview,
            metadata,
          },
          select: { id: true },
        })
      ).id;
    }
  }
  return {
    deliverableKey: input.declaration.deliverableKey,
    title: input.declaration.title,
    kind: input.declaration.kind,
    artifactRef: aiArtifactRef(artifactId),
    status: "current",
    sourceNodeRef: input.sourceNodeId,
    ...(input.declaration.summary ? { summary: input.declaration.summary } : {}),
    presentation: input.declaration.presentation ?? {
      primary:
        input.declaration.kind === "table" || input.declaration.kind === "dataset"
          ? "table"
          : "file",
      allowDownload: true,
    },
    placement: input.declaration.placement ?? "primary",
  };
}

export async function registerNodeDeliverables(input: {
  workspaceId: string;
  taskId: string;
  taskSessionId: string | null;
  workBlockId: string | null;
  runId: string | null | undefined;
  sourceNodeId: string;
  sourceNodeRef?: string;
  declarations: NodeDeliverableDeclaration[];
}, suppliedTx?: Prisma.TransactionClient): Promise<NodeDeliverable[]> {
  if (!suppliedTx) {
    return withPlanExecutionDurability((tx) => registerNodeDeliverables(input, tx));
  }
  const client = suppliedTx;
  if (input.declarations.length === 0) return [];
  if (input.workBlockId) {
    const ownedWorkBlock = await client.workBlock.findFirst({
      where: { id: input.workBlockId, taskId: input.taskId },
      select: { id: true },
    });
    if (!ownedWorkBlock) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "Deliverable work block does not belong to the task.",
      );
    }
  }
  const occurrence = input.workBlockId
    ? await client.taskOccurrence.findFirst({
        where: { taskId: input.taskId, workBlockId: input.workBlockId },
        select: { id: true },
      })
    : null;
  const runScope = {
    taskSessionId: input.taskSessionId,
    workBlockId: input.workBlockId,
    occurrenceId: occurrence?.id ?? null,
  };
  const run = input.runId
    ? await client.run.findFirst({
        where: { id: input.runId, taskId: input.taskId, ...runScope },
        select: { id: true, occurrenceId: true },
      })
    : await client.run.findFirst({
        where: {
          taskId: input.taskId,
          ...runScope,
          status: { in: ["Pending", "Running", "WaitingForApproval", "WaitingForInput"] },
        },
        orderBy: { startedAt: "desc" },
        select: { id: true, occurrenceId: true },
      });
  if (!run) {
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "Canonical Run is unavailable for deliverable registration.",
    );
  }
  const registered: NodeDeliverable[] = [];
  for (const declaration of input.declarations) {
    registered.push(
      await registerDeclaration({
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        runId: run.id,
        occurrenceId: run.occurrenceId,
        sourceNodeId: input.sourceNodeId,
        declaration,
      }, client).then((deliverable) => ({
        ...deliverable,
        sourceNodeRef: input.sourceNodeRef ?? deliverable.sourceNodeRef,
      })),
    );
  }
  return registered;
}

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import type {
  AiArtifactRef,
  NodeDeliverable,
  NodeDeliverableDeclaration,
} from "@chrona/contracts/ai";
import { db } from "@/lib/db";
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

async function inspectGeneratedFile(uri: string) {
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
  const fileStat = await stat(canonicalPath);
  if (!fileStat.isFile()) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Generated deliverable must be a regular file.",
    );
  }
  const content = await readFile(canonicalPath);
  const extension = extname(canonicalPath).toLowerCase();
  const relativePath = relative(resolve(generatedFilesRoot()), canonicalPath)
    .split(sep)
    .join("/");
  return {
    uri: `generated://${relativePath}`,
    checksum: createHash("sha256").update(content).digest("hex"),
    size: fileStat.size,
    mimeType: MIME_TYPES[extension] ?? "application/octet-stream",
    contentPreview: TEXT_EXTENSIONS.has(extension)
      ? content.subarray(0, PREVIEW_BYTES).toString("utf8")
      : null,
  };
}

async function artifactFromRef(input: {
  workspaceId: string;
  taskId: string;
  runId: string;
  ref: AiArtifactRef;
}) {
  const artifacts = await db.artifact.findMany({
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
}): Promise<NodeDeliverable> {
  let artifactId: string;
  if (input.declaration.source.type === "existing_artifact") {
    artifactId = (
      await artifactFromRef({
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        runId: input.runId,
        ref: input.declaration.source.artifactRef,
      })
    ).id;
  } else {
    const file = await inspectGeneratedFile(input.declaration.source.uri);
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
    const existing = await db.artifact.findFirst({
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
        await db.artifact.create({
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
  runId: string | null | undefined;
  sourceNodeId: string;
  sourceNodeRef?: string;
  declarations: NodeDeliverableDeclaration[];
}): Promise<NodeDeliverable[]> {
  if (input.declarations.length === 0) return [];
  const run = input.runId
    ? await db.run.findFirst({
        where: { id: input.runId, taskId: input.taskId },
        select: { id: true, occurrenceId: true },
      })
    : await db.run.findFirst({
        where: {
          taskId: input.taskId,
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
      }).then((deliverable) => ({
        ...deliverable,
        sourceNodeRef: input.sourceNodeRef ?? deliverable.sourceNodeRef,
      })),
    );
  }
  return registered;
}

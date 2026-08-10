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
  // The task artifact registry is the allowlist for the result-file rail. The
  // finalized spec may intentionally omit supporting files from its narrative,
  // but every file surfaced by the rail must remain downloadable.
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

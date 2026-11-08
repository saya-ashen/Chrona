import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { executionEventPayloadSchema, executionResultSchema, executionResultSourceSchema } from "./contract.js";
import { codingError, readCodingWork, type CodingContext } from "./storage";

const MAX_RESULT_BYTES = 20 * 1024 * 1024;

/** Read only a published version owned by this coding application's work journal. */
export async function readCodingResult(context: CodingContext, ref: unknown): Promise<{ base64: string; mime: "application/json" }> {
  if (typeof ref !== "string" || !/^coding\/coding-result-[a-f0-9]{64}\.json$/.test(ref)) throw codingError("invalid", "Invalid coding result reference");
  const filename = ref.slice("coding/".length), hash = filename.slice("coding-result-".length, -".json".length);
  const bytes = await readArtifact(context, filename);
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw codingError("conflict", "Coding result hash mismatch");
  const source = decodeArtifact(bytes);
  const work = await readCodingWork(context, source.workId);
  const result = executionResultSchema.safeParse(work.results.find(item => item.artifactRef === `coding-result-${hash}`));
  if (!result.success || result.data.resultId !== `result-${hash}` || work.start.workId !== source.workId) throw codingError("not_found", "Coding result is not published by this work");
  for (const field of ["workId", "sessionId", "runId", "attemptId", "baseline"] as const) {
    if (!isDeepStrictEqual(source[field], result.data[field])
      || field !== "baseline" && source[field] !== work.ref?.[field]) throw codingError("conflict", "Coding result identity mismatch");
  }
  return { base64: bytes.toString("base64"), mime: "application/json" };
}

function decodeArtifact(bytes: Buffer) {
  let artifact;
  try { artifact = JSON.parse(bytes.toString("utf8")); }
  catch { throw codingError("conflict", "Invalid coding result JSON"); }
  if (!artifact || typeof artifact !== "object") throw codingError("conflict", "Invalid coding result content");
  const { workId, sessionId, runId, attemptId, baseline, changes, finalMessage: final } = artifact;
  const source = executionResultSourceSchema.safeParse({ workId, sessionId, runId, attemptId, baseline, changes });
  if (!source.success || typeof artifact.missing !== "boolean" || !final || typeof final.truncated !== "boolean"
    || !executionEventPayloadSchema.safeParse({ type: "message", messageId: final.messageId, role: "assistant", text: final.text, complete: !final.truncated }).success) throw codingError("conflict", "Invalid coding result content");
  return source.data;
}

async function readArtifact(context: CodingContext, filename: string): Promise<Buffer> {
  const directory = join(context.dir, "artifacts");
  try {
    if (!(await lstat(directory)).isDirectory()) throw codingError("invalid", "Coding artifacts must be a regular directory");
    // NONBLOCK prevents a substituted FIFO from blocking before the regular-file check.
    const file = await open(join(directory, filename), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw codingError("invalid", "Coding result must be a regular file");
      if (stat.size > MAX_RESULT_BYTES) throw codingError("too_large", "Coding result exceeds 20 MiB");
      const buffer = Buffer.alloc(stat.size);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      const after = await file.stat();
      if (after.size > MAX_RESULT_BYTES) throw codingError("too_large", "Coding result exceeds 20 MiB");
      if (size !== stat.size || after.size !== stat.size) throw codingError("conflict", "Coding result changed during read");
      return buffer.subarray(0, size);
    } finally { await file.close(); }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw codingError("not_found", "Coding result not found");
    if (code === "ELOOP") throw codingError("invalid", "Coding result cannot be a symbolic link");
    throw error;
  }
}

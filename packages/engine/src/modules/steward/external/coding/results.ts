import { MAX_ARTIFACT_BYTES } from "./output";
import { callAgent, lookupCodingWork } from "./agent";
import { createHash } from "node:crypto";
import { link, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { executionSnapshotSchema, executionResultSourceSchema, type ExecutionView, type ExecutionSnapshot, type ExecutionResultSource, type ExecutionResult } from "./contract.js";
import { codingError, readCodingWork, writeCodingWork, type CodingContext, type CodingWork } from "./storage";

async function immutableArtifact(dir: string, artifactRef: string, text: string) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${artifactRef}.json`);
  const temporary = `${path}.tmp`;
  const file = await open(temporary, "w", 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  try {
    // Publish complete bytes atomically without replacing an existing immutable version.
    try { await link(temporary, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await readFile(path, "utf8") !== text) throw codingError("conflict", "Result artifact changed");
    }
  } finally { await rm(temporary, { force: true }); }
  const directory = await open(dir, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
function matchesExecution(actual: Pick<ExecutionView, "workId" | "sessionId" | "runId" | "attemptId">, expected: Pick<ExecutionView, "workId" | "sessionId" | "runId" | "attemptId">): boolean {
  return actual.workId === expected.workId && actual.sessionId === expected.sessionId && actual.runId === expected.runId && actual.attemptId === expected.attemptId;
}
async function storedArtifact(context: CodingContext, result: ExecutionResult) {
  if (!/^coding-result-[a-f0-9]{64}$/.test(result.artifactRef)) throw codingError("conflict", "Invalid result artifact identity");
  const path = join(context.dir, "artifacts", `${result.artifactRef}.json`);
  if ((await stat(path)).size > MAX_ARTIFACT_BYTES) throw codingError("too_large", "Coding result exceeds artifact budget");
  const text = await readFile(path, "utf8"), hash = createHash("sha256").update(text).digest("hex");
  if (`result-${hash}` !== result.resultId || `coding-result-${hash}` !== result.artifactRef) throw codingError("conflict", "Result artifact changed");
  const artifact = JSON.parse(text) as ExecutionResultSource;
  if (!matchesExecution(artifact, result) || JSON.stringify(artifact.baseline) !== JSON.stringify(result.baseline)) throw codingError("conflict", "Result artifact identity changed");
  return text;
}
/** Read-side result capture never starts another execution. */
export async function reconcileCodingResult(context: CodingContext, work: CodingWork, view: ExecutionView): Promise<void> {
  if (!view.stopConfirmed || !["completed", "failed", "cancelled"].includes(view.status)) return;
  const existing = work.results.find(result => result.attemptId === view.attemptId);
  if (existing) {
    const text = await storedArtifact(context, existing);
    await immutableArtifact(context.content, existing.artifactRef, text);
    return;
  }
  const target = { workId: view.workId, runId: view.runId, attemptId: view.attemptId };
  const snapshot = await callAgent<ExecutionSnapshot>(context, "snapshot", target);
  if (!executionSnapshotSchema.safeParse(snapshot).success || !matchesExecution(snapshot, view)) throw codingError("conflict", "Result snapshot does not match execution");
  if (!snapshot.stopConfirmed || snapshot.status !== view.status || !snapshot.finalMessage) return;
  const source = await callAgent<ExecutionResultSource>(context, "result-source", {
    workId: view.workId, runId: view.runId, attemptId: view.attemptId,
  });
  if (!executionResultSourceSchema.safeParse(source).success || !matchesExecution(source, view)) throw codingError("conflict", "Result source does not match execution");
  const artifact = { ...work.ref!, baseline: source.baseline, finalMessage: { ...snapshot.finalMessage }, missing: snapshot.missing, checks: [], ...(source.changes ? { changes: structuredClone(source.changes) } : {}) };
  const text = artifactText(artifact), hash = createHash("sha256").update(text).digest("hex");
  const artifactRef = `coding-result-${hash}`;
  await immutableArtifact(join(context.dir, "artifacts"), artifactRef, text);
  await immutableArtifact(context.content, artifactRef, text);
  work.results.push({ ...work.ref!, resultId: `result-${hash}`, baseline: source.baseline, artifactRef, accepted: false, checks: [] });
}
function artifactText(artifact: ExecutionResultSource & { finalMessage: NonNullable<ExecutionSnapshot["finalMessage"]>; missing: boolean; checks: never[] }): string {
  if (Buffer.byteLength(JSON.stringify(artifact)) > MAX_ARTIFACT_BYTES && artifact.changes) {
    artifact.changes.status = "partial"; artifact.changes.reason = "limit"; artifact.changes.patch = "";
    for (const file of artifact.changes.files) if (file.text !== undefined) { delete file.text; file.omitted = "size"; }
  }
  if (Buffer.byteLength(JSON.stringify(artifact)) > MAX_ARTIFACT_BYTES) {
    artifact.finalMessage.text = ""; artifact.finalMessage.truncated = true; artifact.missing = true;
  }
  if (Buffer.byteLength(JSON.stringify(artifact)) > MAX_ARTIFACT_BYTES) throw codingError("too_large", "Coding result exceeds artifact budget");
  return JSON.stringify(artifact);
}
async function refreshCodingResults(context: CodingContext, input: { workId: string }) {
  const stored = await readCodingWork(context, input.workId);
  if (stored.results.length) {
    for (const result of stored.results) {
      const text = await storedArtifact(context, result);
      await immutableArtifact(context.content, result.artifactRef, text);
    }
    return;
  }
  const { work, view } = await lookupCodingWork(context, input);
  await reconcileCodingResult(context, work, view);
  await writeCodingWork(context, work);
}
export async function listCodingResults(context: CodingContext, input: { workId: string }) {
  await refreshCodingResults(context, input);
  return { results: (await readCodingWork(context, input.workId)).results.map(result => ({ ...result })) };
}
export async function acceptCodingResult(context: CodingContext, input: { workId: string; resultId: string; commandKey: string }): Promise<{ accepted: true }> {
  await refreshCodingResults(context, { workId: input.workId });
  const work = await readCodingWork(context, input.workId);
  const receipt = work.acceptances.find(item => item.commandKey === input.commandKey);
  if (receipt && receipt.resultId !== input.resultId) throw codingError("conflict", "Acceptance key belongs to another result");
  const result = work.results.find(item => item.resultId === input.resultId);
  if (!result) throw codingError("not_found", "Coding result not found");
  if (!receipt) {
    work.acceptances.push({ commandKey: input.commandKey, resultId: input.resultId });
    result.accepted = true;
    await writeCodingWork(context, work);
  }
  return { accepted: true };
}

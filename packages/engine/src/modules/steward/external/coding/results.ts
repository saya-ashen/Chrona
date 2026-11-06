import { createHash } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionView, ExecutionSnapshot, ExecutionResultSource } from "./contract.js";
import { codingError, lookupCodingWork, readCodingWork, writeCodingWork, type CodingContext, type CodingWork } from "./storage";

async function immutableArtifact(dir: string, artifactRef: string, text: string) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${artifactRef}.json`);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, text);
  try {
    // Publish complete bytes atomically without replacing an existing immutable version.
    try { await link(temporary, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await readFile(path, "utf8") !== text) throw codingError("conflict", "Result artifact changed");
    }
  } finally { await rm(temporary, { force: true }); }
}
/** Shared by reads, activation recovery and the completion receipt; never starts another execution. */
export async function reconcileCodingResult(context: CodingContext, work: CodingWork, view: ExecutionView): Promise<void> {
  if (!view.stopConfirmed || !["completed", "failed", "cancelled"].includes(view.status)) return;
  const existing = work.results.find(result => result.attemptId === view.attemptId);
  if (existing) {
    const text = await readFile(join(context.dir, "artifacts", `${existing.artifactRef}.json`), "utf8");
    await immutableArtifact(context.content, existing.artifactRef, text);
    return;
  }
  const target = { workId: view.workId, runId: view.runId, attemptId: view.attemptId };
  const snapshot = await context.call<ExecutionSnapshot>("executions.snapshot", target);
  if (!snapshot.stopConfirmed || snapshot.status !== view.status || !snapshot.finalMessage) return;
  const source = await context.call<ExecutionResultSource>("executions.result-source", {
    workId: view.workId, runId: view.runId, attemptId: view.attemptId,
  });
  if (source.workId !== view.workId || source.runId !== view.runId || source.attemptId !== view.attemptId || source.sessionId !== view.sessionId) throw codingError("conflict", "Result source does not match execution");
  const artifact = { ...work.ref!, baseline: source.baseline, finalMessage: { ...snapshot.finalMessage }, missing: snapshot.missing, checks: [], ...(source.changes ? { changes: structuredClone(source.changes) } : {}) };
  const text = artifactText(artifact), hash = createHash("sha256").update(text).digest("hex");
  const artifactRef = `coding-result-${hash}`;
  await immutableArtifact(join(context.dir, "artifacts"), artifactRef, text);
  await immutableArtifact(context.content, artifactRef, text);
  work.results.push({ ...work.ref!, resultId: `result-${hash}`, baseline: source.baseline, artifactRef, accepted: false, checks: [] });
}
function artifactText(artifact: ExecutionResultSource & { finalMessage: NonNullable<ExecutionSnapshot["finalMessage"]>; missing: boolean; checks: never[] }): string {
  if (Buffer.byteLength(JSON.stringify(artifact)) > 192 * 1024 && artifact.changes) {
    artifact.changes.status = "partial"; artifact.changes.reason = "limit"; artifact.changes.patch = "";
    for (const file of artifact.changes.files) if (file.text !== undefined) { delete file.text; file.omitted = "size"; }
  }
  if (Buffer.byteLength(JSON.stringify(artifact)) > 192 * 1024) {
    artifact.finalMessage.text = ""; artifact.finalMessage.truncated = true; artifact.missing = true;
  }
  if (Buffer.byteLength(JSON.stringify(artifact)) > 192 * 1024) throw codingError("too_large", "Coding result exceeds artifact budget");
  return JSON.stringify(artifact);
}
async function refreshCodingResults(context: CodingContext, input: { workId: string }) {
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

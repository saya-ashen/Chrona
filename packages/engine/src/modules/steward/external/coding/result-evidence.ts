import { isAbsolute } from "node:path";
import { executionResultSourceSchema, executionSnapshotSchema, type ExecutionRef, type ExecutionResultSource, type ExecutionSnapshot } from "./contract.js";
import { codingError, type CodingContext } from "./storage";
import { digest, readPrivate } from "./mutations";
import { saveSessionFile } from "./sessions";
import { captureWorkspaceChanges, unavailableChanges } from "./project-changes";
import { verifyProjectDirectory } from "./project-evidence";

export type ProjectAdmission = { path: string; identity: string; baseline: ExecutionResultSource["baseline"]; contextId?: string };
type Evidence = { version: 1; ref: ExecutionRef; project: ProjectAdmission; stage: "capturing" | "frozen"; snapshot: ExecutionSnapshot; text?: string; source?: ExecutionResultSource };
const name = (workId: string) => `evidence-${digest(workId)}.json`;
const locks = new Map<string, Promise<unknown>>();
function sameRef(raw: unknown, b: ExecutionRef) {
  if (!raw || typeof raw !== "object") return false;
  const a = raw as Partial<ExecutionRef>;
  return a.workId === b.workId && a.sessionId === b.sessionId && a.runId === b.runId && a.attemptId === b.attemptId;
}
export function validProjectAdmission(raw: unknown): raw is ProjectAdmission {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as Partial<ProjectAdmission>;
  return typeof value.path === "string" && isAbsolute(value.path) && typeof value.identity === "string" && /^\d+:\d+$/.test(value.identity)
    && value.baseline !== undefined && executionResultSourceSchema.safeParse({ workId: "w", sessionId: "s", runId: "r", attemptId: "a", baseline: value.baseline }).success && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.baseline.digest)
    && (value.contextId === undefined || typeof value.contextId === "string");
}
function validEvidence(raw: unknown, ref: ExecutionRef) {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as Evidence;
  return (value as { version: unknown }).version === 1 && validProjectAdmission(value.project) && sameRef(value.ref, ref) && sameRef(value.snapshot, ref)
    && executionSnapshotSchema.safeParse(value.snapshot).success && value.snapshot.stopConfirmed
    && (value.text === undefined || typeof value.text === "string") && ["capturing", "frozen"].includes(value.stage);
}
async function stored(context: CodingContext, ref: ExecutionRef, project?: ProjectAdmission): Promise<Evidence | undefined> {
  const value = await readPrivate<Evidence>(context, name(ref.workId), 9 * 1024 * 1024);
  if (value === undefined) return undefined;
  if (!validEvidence(value, ref) || project && JSON.stringify(project) !== JSON.stringify(value.project)) throw codingError("conflict", "Coding result evidence identity changed");
  if (value.stage === "frozen" && (!executionResultSourceSchema.safeParse(value.source).success || !sameRef(value.source, ref) || JSON.stringify(value.source!.baseline) !== JSON.stringify(value.project.baseline))) throw codingError("conflict", "Invalid frozen Coding evidence");
  return value;
}
async function finish(context: CodingContext, evidence: Evidence, changes: NonNullable<ExecutionResultSource["changes"]>) {
  evidence.source = executionResultSourceSchema.parse({ ...evidence.ref, baseline: evidence.project.baseline, changes });
  evidence.stage = "frozen";
  await saveSessionFile(context, name(evidence.ref.workId), evidence);
  return evidence;
}
async function exclusive<T>(context: CodingContext, ref: ExecutionRef, action: () => Promise<T>): Promise<T> {
  const key = `${context.dir}:${ref.workId}`, previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action); locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}
/** A crash after the durable capturing marker cannot reopen the project and invent later evidence. */
async function recover(context: CodingContext, value: Evidence) {
  return value.stage === "capturing" ? finish(context, value, unavailableChanges("capture_failed")) : value;
}
export async function readFrozenEvidence(context: CodingContext, ref: ExecutionRef, project?: ProjectAdmission) {
  return exclusive(context, ref, async () => { const value = await stored(context, ref, project); return value ? recover(context, value) : undefined; });
}
/** Stop is confirmed by the caller before entering. Disk failures propagate and block continuation. */
export async function freezeResultEvidence(context: CodingContext, ref: ExecutionRef, project: ProjectAdmission, snapshot: ExecutionSnapshot, options: { text?: string; observe?: () => Promise<{ snapshot: ExecutionSnapshot; text?: string }> } = {}) {
  const { text, observe } = options;
  return exclusive(context, ref, async () => {
    const existing = await stored(context, ref, project);
    if (existing) return recover(context, existing);
    const value: Evidence = { version: 1, ref, project, stage: "capturing", snapshot, ...(text !== undefined ? { text } : {}) };
    await saveSessionFile(context, name(ref.workId), value);
    let changes: NonNullable<ExecutionResultSource["changes"]>;
    try { await verifyProjectDirectory(project.path, project.identity); changes = await captureWorkspaceChanges(project.path, project.baseline); await verifyProjectDirectory(project.path, project.identity); }
    catch { changes = unavailableChanges("baseline_unverified"); }
    if (observe) {
      try { Object.assign(value, await observe()); }
      catch (error) { if (!["unavailable", "not_found"].includes((error as { code?: string }).code ?? "")) throw error; }
    }
    return finish(context, value, changes);
  });
}

import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { ModelError } from "chrona";
import { executionIdSchema, executionStartSchema, executionRefSchema, executionResultSchema, executionViewSchema, type ExecutionView } from "./contract.js";

import type { CodingContext, CodingWork } from "./types";
export type { CodingContext, CodingWork } from "./types";
export function codingError(code: string, message: string): Error & { code: string } {
  return new ModelError(code, message);
}
export async function readCodingWork(context: CodingContext, workId: string): Promise<CodingWork> {
  if (!executionIdSchema.safeParse(workId).success) throw codingError("invalid", "Invalid work identity");
  try {
    const path = join(context.dir, `${workId}.json`);
    if ((await stat(path)).size > 8 * 1024 * 1024) throw codingError("too_large", "Coding work exceeds storage budget");
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!raw || typeof raw !== "object") throw codingError("conflict", "Invalid coding work journal");
    const work = raw as CodingWork, start = executionStartSchema.safeParse(work.start);
    if (!start.success || start.data.workId !== workId || !validRef(work, workId) || !Array.isArray(work.results) || !Array.isArray(work.acceptances)) throw codingError("conflict", "Invalid coding work journal");
    validateResults(work, workId); validateAcceptances(work);
    return work;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw codingError("not_found", "Coding work not found");
    throw error;
  }
}
function validRef(work: CodingWork, workId: string) { return work.ref === undefined || executionRefSchema.safeParse(work.ref).success && work.ref.workId === workId; }
function validateResults(work: CodingWork, workId: string) {
  for (const result of work.results) if (!executionResultSchema.safeParse(result).success || !work.ref || result.workId !== workId || result.sessionId !== work.ref.sessionId || result.runId !== work.ref.runId || result.attemptId !== work.ref.attemptId) throw codingError("conflict", "Invalid stored coding result identity");
  if (new Set(work.results.map(result => result.resultId)).size !== work.results.length) throw codingError("conflict", "Duplicate stored coding result");
}
function validateAcceptances(work: CodingWork) {
  const valid = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return false;
    const entry = raw as Record<string, unknown>;
    return executionIdSchema.safeParse(entry.commandKey).success && work.results.some(result => result.resultId === entry.resultId && result.accepted);
  };
  if (!work.acceptances.every(valid) || new Set(work.acceptances.map(item => item.commandKey)).size !== work.acceptances.length) throw codingError("conflict", "Invalid stored coding acceptance");
}
export async function writeCodingWork(context: CodingContext, work: CodingWork) {
  await mkdir(context.dir, { recursive: true });
  const path = join(context.dir, `${work.start.workId}.json`);
  const file = await open(`${path}.tmp`, "w", 0o600);
  try { await file.writeFile(JSON.stringify(work)); await file.sync(); } finally { await file.close(); }
  await rename(`${path}.tmp`, path);
  const directory = await open(context.dir, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
export function remember(work: CodingWork, view: ExecutionView) {
  if (!executionViewSchema.safeParse(view).success) throw codingError("conflict", "Invalid Agent execution view");
  if (view.workId !== work.start.workId || view.projectRef !== work.start.projectRef
    || work.ref && (work.ref.sessionId !== view.sessionId || work.ref.runId !== view.runId || work.ref.attemptId !== view.attemptId)) throw codingError("conflict", "Execution does not match coding work");
  work.ref = { workId: view.workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId };
}

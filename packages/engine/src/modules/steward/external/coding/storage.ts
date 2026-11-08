import { callAgent } from "./agent";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModelError } from "chrona";
import type { ExecutionView } from "./contract.js";

import type { CodingContext, CodingWork } from "./types";
export type { CodingContext, CodingWork } from "./types";
export function codingError(code: string, message: string): Error & { code: string } {
  return new ModelError(code, message);
}
export async function readCodingWork(context: CodingContext, workId: string): Promise<CodingWork> {
  try { return JSON.parse(await readFile(join(context.dir, `${workId}.json`), "utf8")) as CodingWork; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw codingError("not_found", "Coding work not found");
    throw error;
  }
}
export async function writeCodingWork(context: CodingContext, work: CodingWork) {
  await mkdir(context.dir, { recursive: true });
  const path = join(context.dir, `${work.start.workId}.json`);
  await writeFile(`${path}.tmp`, JSON.stringify(work));
  await rename(`${path}.tmp`, path);
}
export function remember(work: CodingWork, view: ExecutionView) {
  if (view.workId !== work.start.workId || view.projectRef !== work.start.projectRef
    || work.ref && (work.ref.sessionId !== view.sessionId || work.ref.runId !== view.runId || work.ref.attemptId !== view.attemptId)) throw codingError("conflict", "Execution does not match coding work");
  work.ref = { workId: view.workId, sessionId: view.sessionId, runId: view.runId, attemptId: view.attemptId };
}

export async function lookupCodingWork(context: CodingContext, input: { workId: string }) {
  const work = await readCodingWork(context, input.workId);
  const view = work.ref
    ? await callAgent<ExecutionView>(context, "get", input)
    : await callAgent<ExecutionView>(context, "lookup-start", { commandKey: work.start.commandKey });
  remember(work, view);
  return { work, view };
}

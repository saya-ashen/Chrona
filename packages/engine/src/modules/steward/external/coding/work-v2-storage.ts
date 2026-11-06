import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { workStartSchema, workViewSchema, workCommandSchema, type WorkStart, type WorkView, type WorkCommand } from "./contract.js";
import { codingError, type CodingContext } from "./storage";

export type WorkRecord = { start: WorkStart; views: WorkView[]; dispatching: string[]; cancels: Extract<WorkCommand, { op: "cancel" }>[] };
export type WorkRegistry = { version: 1; records: WorkRecord[] };
export async function readRegistry(context: CodingContext): Promise<WorkRegistry> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(context.dir, "works-v2.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, records: [] }; throw error; }
  const registry = raw as { version: unknown; records: WorkRecord[] };
  if (registry.version !== 1 || !Array.isArray(registry.records)) throw codingError("conflict", "Invalid stored work registry");
  for (const record of registry.records) {
    record.start = workStartSchema.parse(record.start);
    record.views = record.views.map(view => workViewSchema.parse(view));
    if (!Array.isArray(record.dispatching) || !Array.isArray(record.cancels)) throw codingError("conflict", "Invalid stored work journal");
    const ids = record.start.kind === "group" ? [record.start.workId, ...record.start.children.map(child => child.workId)] : [record.start.workId];
    if (record.views.length !== ids.length || record.views.some((view, i) => view.workId !== ids[i]) || record.dispatching.some(id => !ids.includes(id))) throw codingError("conflict", "Stored work identities disagree");
    record.cancels = record.cancels.map(command => {
      const parsed = workCommandSchema.parse(command);
      if (parsed.op !== "cancel" || !ids.includes(parsed.workId)) throw codingError("conflict", "Stored cancellation target changed");
      return parsed;
    });
  }
  return { version: 1, records: registry.records };
}
export async function saveRegistry(context: CodingContext, registry: WorkRegistry) {
  await mkdir(context.dir, { recursive: true });
  const path = join(context.dir, "works-v2.json"), temporary = `${path}.next`;
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(registry)); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
  const directory = await open(context.dir, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
export function findWork(registry: WorkRegistry, workId: string) {
  for (const record of registry.records) {
    const view = record.views.find(item => item.workId === workId);
    if (view) return { record, view };
  }
  throw codingError("not_found", "Work not found");
}
// One SDK module process owns its private journal; serialize read/modify/dispatch and parent fences.
let pending: Promise<unknown> = Promise.resolve();
export function serializeWork<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}

import { constants } from "node:fs";
import { access, lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { codingError } from "./storage";
import { validId } from "./commands";
import { readPrivate } from "./mutations";
import type { CodingContext } from "./types";

export type CodingProject = { projectRef: string; path: string; label: string };
export type CodingProjectIdentity = { projectRef: string; path: string; identity: string };
export type CodingProjectRow = CodingProject & { identity: string };
const boundedText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 8192;
const projectPath = (value: unknown) => boundedText(value) && isAbsolute(value) && resolve(value) === value && !value.includes("\0");
const projectRef = (value: unknown) => typeof value === "string" && validId(value);
const directoryIdentity = (value: unknown) => typeof value === "string" && /^\d+:\d+$/.test(value);
const fields = { projectRef, path: projectPath, label: boundedText, identity: directoryIdentity };
function isProjectRow(value: unknown): value is CodingProjectRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 4 && Object.entries(fields).every(([key, valid]) => valid(row[key]));
}
export async function readProjectRegistry(context: CodingContext): Promise<CodingProjectRow[]> {
  const raw = await readPrivate<unknown>(context, "projects.json");
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 100 || !raw.every(isProjectRow)) throw codingError("conflict", "Invalid Coding project registry");
  const rows = raw;
  if (new Set(rows.map(row => row.projectRef)).size !== rows.length || new Set(rows.map(row => row.path)).size !== rows.length) throw codingError("conflict", "Duplicate Coding project registry identity");
  return rows;
}
/** Resolve aliases only during registration; persisted paths must remain exact directories. */
export async function codingProjectDirectory(input: string): Promise<{ path: string; identity: string }> {
  if (!isAbsolute(input)) throw codingError("invalid", "Project path must be absolute");
  try {
    const path = await realpath(input), info = await lstat(path, { bigint: true });
    if (!info.isDirectory()) throw codingError("invalid", "Project path must be a directory");
    await access(path, constants.R_OK | constants.W_OK | constants.X_OK);
    return { path, identity: `${info.dev}:${info.ino}` };
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw codingError("invalid", "Project directory does not exist");
    throw error;
  }
}
export async function verifyCodingProject(project: CodingProjectIdentity): Promise<void> {
  let current: { path: string; identity: string };
  try { current = await codingProjectDirectory(project.path); }
  catch (error) {
    if ((error as { code?: string }).code === "invalid") throw codingError("conflict", "Coding project directory is missing or replaced");
    throw error;
  }
  if (current.path !== project.path || current.identity !== project.identity) throw codingError("conflict", "Coding project directory identity changed");
}
export async function resolveProjectRow(context: CodingContext, projectRef: string): Promise<CodingProjectRow> {
  const row = (await readProjectRegistry(context)).find(row => row.projectRef === projectRef);
  if (!row) throw codingError("not_found", "Coding project is not registered");
  await verifyCodingProject(row);
  return row;
}
export async function resolveCodingProject(context: CodingContext, projectRef: string): Promise<CodingProjectIdentity> {
  const { path, identity } = await resolveProjectRow(context, projectRef);
  return { projectRef, path, identity };
}
async function exactDirectory(path: string) {
  const info = await lstat(path, { bigint: true });
  if (!info.isDirectory() || await realpath(path) !== path) throw codingError("conflict", "Coding managed directory path changed");
  return { projectRef: "managed-root", path, identity: `${info.dev}:${info.ino}` };
}
async function ensureManagedDirectory(path: string) {
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  return exactDirectory(path);
}
/** The runtime's private data directory supplies scope; no caller-selected creation path. */
export async function createManagedProjectDirectory(context: CodingContext, name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw codingError("invalid", "Invalid project name");
  const data = await exactDirectory(resolve(context.dir));
  const root = await ensureManagedDirectory(join(data.path, "managed-projects"));
  await verifyCodingProject(data);
  const project = await ensureManagedDirectory(join(root.path, name));
  await verifyCodingProject(data); await verifyCodingProject(root);
  return { path: project.path, identity: project.identity };
}
/** Verify parents even when the logical name is already registered. */
export async function verifyManagedProject(context: CodingContext, project: CodingProjectIdentity) {
  await exactDirectory(resolve(context.dir));
  await exactDirectory(join(resolve(context.dir), "managed-projects"));
  await verifyCodingProject(project);
}

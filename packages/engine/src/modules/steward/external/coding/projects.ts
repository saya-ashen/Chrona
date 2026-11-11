import { codingError, type CodingContext } from "./storage";
import { record, validId } from "./commands";

type Project = { projectRef: string; path: string; label: string };
const keys = (raw: Record<string, unknown>, expected: string[]) => Object.keys(raw).length === expected.length && expected.every(key => Object.hasOwn(raw, key));
const identity = (value: unknown) => typeof value === "string" && value.length >= 1 && value.length <= 256;
function principal(raw: unknown) {
  return record(raw) && keys(raw, ["workspaceId", "ownerId", "caller"]) && identity(raw.workspaceId) && raw.ownerId === "owner"
    && record(raw.caller) && keys(raw.caller, ["kind", "moduleId", "hash"]) && raw.caller.kind === "module" && identity(raw.caller.moduleId) && identity(raw.caller.hash);
}
function project(raw: unknown): Project {
  if (!record(raw) || !keys(raw, ["projectRef", "path", "label"]) || !validId(raw.projectRef) || typeof raw.path !== "string" || !raw.path.startsWith("/") || raw.path.length > 8192 || typeof raw.label !== "string" || !raw.label.length || raw.label.length > 8192) throw codingError("conflict", "Invalid project response from Agent");
  return { projectRef: raw.projectRef, path: raw.path, label: raw.label };
}
function response(raw: unknown, action: string): Record<string, unknown> {
  if (!record(raw) || !keys(raw, ["action", "principal", action === "list" ? "projects" : "project"]) || raw.action !== action || !principal(raw.principal)) throw codingError("conflict", "Invalid tagged project response from Agent");
  return raw;
}
export async function listProjects(context: CodingContext) {
  const raw = response(await context.call<unknown>("agent.work-projects", { action: "list" }), "list");
  if (!Array.isArray(raw.projects) || raw.projects.length > 100) throw codingError("conflict", "Invalid project list from Agent");
  const items = raw.projects.map(project);
  if (new Set(items.map(item => item.projectRef)).size !== items.length) throw codingError("conflict", "Duplicate project identity from Agent");
  return items;
}
export async function mutateProject(context: CodingContext, input: { action: "create"; name: string } | { action: "register"; path: string }) {
  return project(response(await context.call<unknown>("agent.work-projects", input), input.action).project);
}

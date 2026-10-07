import { db } from "@chrona/db";
import { WorkResultError } from "../results/access";
export type LibraryActor = { workspaceId: string; actorKey: string; isOwner: boolean; canOrganize: boolean; canConfigure: boolean };
export type LibraryPorts = { authorize: (permission: "read" | "organize" | "configure") => Promise<LibraryActor> };
export const libraryWritesEnabled = () => process.env.CHRONA_LIBRARY_WRITES_ENABLED === "true";
export const libraryRevision = (workspaceId: string, revision: number) => `library-v1:${workspaceId}:${revision}`;
export function libraryCapabilities(scopes: readonly string[]) {
  const canRead = scopes.includes("tasks:read") && scopes.includes("library:read");
  return { contractVersion: 1, canRead, canOrganize: canRead && scopes.includes("library:organize") && libraryWritesEnabled(), canConfigure: canRead && scopes.includes("library:configure") && libraryWritesEnabled(), writesEnabled: libraryWritesEnabled(), manualChoicesProtected: true, executionStarted: false };
}
export async function authorizeLibrary(ports: LibraryPorts, permission: "read" | "organize" | "configure") {
  const actor = await ports.authorize(permission);
  const workspace = await db.workspace.findUnique({ where: { id: actor.workspaceId }, select: { status: true } });
  if (!workspace) throw new WorkResultError("NOT_FOUND", "Workspace not found");
  if (permission !== "read") {
    if (!(permission === "configure" ? actor.canConfigure : actor.canOrganize)) throw new WorkResultError("FORBIDDEN", "Library authority is required");
    if (!libraryWritesEnabled() || workspace.status !== "Active") throw new WorkResultError("PRECONDITION_FAILED", "Library writes are disabled or workspace is archived");
  }
  return actor;
}
export async function scopedLibraryTask(actor: LibraryActor, taskId: string) {
  const task = await db.task.findFirst({ where: { id: taskId, workspaceId: actor.workspaceId } });
  if (!task) throw new WorkResultError("NOT_FOUND", "Content not found in this workspace");
  return task;
}
export async function scopedGroup(actor: LibraryActor, id: string) {
  const group = await db.libraryGroup.findFirst({ where: { id, workspaceId: actor.workspaceId } });
  if (!group) throw new WorkResultError("NOT_FOUND", "Classification group not found");
  return group;
}
export async function scopedFolder(actor: LibraryActor, id: string) {
  const folder = await db.libraryFolder.findFirst({ where: { id, group: { workspaceId: actor.workspaceId } }, include: { group: true } });
  if (!folder) throw new WorkResultError("NOT_FOUND", "Folder not found");
  return folder;
}
export function libraryNameKey(name: string) {
  const key = name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  if (!key) throw new WorkResultError("VALIDATION_ERROR", "A non-empty classification name is required");
  return key;
}

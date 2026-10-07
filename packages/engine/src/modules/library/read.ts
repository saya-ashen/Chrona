import { db, type Prisma } from "@chrona/db";
import type { LibraryRead, LibraryView, LibraryItem, LibraryReceipt } from "@chrona/contracts/library";
import { WorkResultError } from "../results/access";
import { libraryRevision, libraryWritesEnabled, scopedLibraryTask, scopedGroup, scopedFolder, type LibraryActor } from "./access";

async function catalog(actor: LibraryActor, groupId?: string) {
  const totalItems = await db.task.count({ where: { workspaceId: actor.workspaceId } });
  const rows = await db.libraryGroup.findMany({ where: { workspaceId: actor.workspaceId }, orderBy: [{ nameKey: "asc" }, { id: "asc" }], include: { _count: { select: { folders: true, assignments: { where: { folderId: { not: null } } } } } } });
  const groups = rows.map(({ id, name, instructions, allowAgentFolders, _count }) => ({ id, name, instructions, allowAgentFolders, folderCount: _count.folders, classifiedCount: _count.assignments, unclassifiedCount: totalItems - _count.assignments }));
  const folders = groupId ? (await db.libraryFolder.findMany({ where: { groupId }, orderBy: [{ nameKey: "asc" }, { id: "asc" }], include: { _count: { select: { assignments: true } } } })).map(({ id, groupId: group, name, description, _count }) => ({ id, groupId: group, name, description, count: _count.assignments })) : [];
  return { groups, folders, totalItems };
}
async function items(where: Prisma.TaskWhereInput, offset: number, limit: number): Promise<LibraryItem[]> {
  const rows = await db.task.findMany({ where, orderBy: [{ title: "asc" }, { id: "asc" }], skip: offset, take: limit, select: { id: true, title: true, description: true, taskExecutionMode: true, status: true,
    libraryAssignments: { include: { group: { select: { name: true } }, folder: { select: { name: true } } }, orderBy: { groupId: "asc" } } } });
  return rows.map(({ libraryAssignments, description, ...task }) => ({ ...task, description: description?.slice(0, 240) ?? null, placements: libraryAssignments.map((a) => ({ groupId: a.groupId, groupName: a.group.name, folderId: a.folderId, folderName: a.folder?.name ?? null, protected: a.protected, actorKey: a.actorKey })) }));
}
async function validateScope(actor: LibraryActor, input: LibraryRead) {
  if (input.groupId) await scopedGroup(actor, input.groupId);
  if (input.folderId && (await scopedFolder(actor, input.folderId)).groupId !== input.groupId) throw new WorkResultError("NOT_FOUND", "Folder is not in this group");
  if (input.taskId) await scopedLibraryTask(actor, input.taskId);
}
async function history(actor: LibraryActor, input: LibraryRead, result: LibraryView) {
  const where = { workspaceId: actor.workspaceId, ...(input.taskId ? { taskId: input.taskId } : {}) };
  result.total = await db.libraryCommand.count({ where });
  const rows = await db.libraryCommand.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: input.limit, skip: input.offset });
  for (const row of rows) {
    const entry = row.receipt as unknown as LibraryReceipt;
    if (Buffer.byteLength(JSON.stringify([...result.history, entry])) > 80 * 1024) break;
    result.history.push(entry);
  }
  result.nextOffset = input.offset + result.history.length < result.total ? input.offset + result.history.length : null;
  return result;
}
function itemFilter(workspaceId: string, input: LibraryRead): Prisma.TaskWhereInput {
  return { workspaceId,
    ...(input.taskId ? { id: input.taskId } : {}),
    ...(input.query ? { OR: [{ title: { contains: input.query } }, { description: { contains: input.query } }] } : {}),
    ...(input.folderId ? { libraryAssignments: { some: { groupId: input.groupId, folderId: input.folderId } } } : {}),
    ...(input.unclassified ? { libraryAssignments: { none: { groupId: input.groupId, folderId: { not: null } } } } : {}),
  };
}
export async function readLibrary(actor: LibraryActor, input: LibraryRead): Promise<LibraryView> {
  await validateScope(actor, input);
  const state = await db.libraryState.findUnique({ where: { workspaceId: actor.workspaceId } });
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: actor.workspaceId }, select: { status: true } });
  const enabled = libraryWritesEnabled() && workspace.status === "Active";
  const result: LibraryView = { revision: libraryRevision(actor.workspaceId, state?.revision ?? 0), canOrganize: actor.canOrganize && enabled, canConfigure: actor.canConfigure && enabled, isOwner: actor.isOwner, writesEnabled: enabled,
    ...await catalog(actor, input.groupId), items: [], total: 0, nextOffset: null, history: [] };
  if (input.view === "catalog") return result;
  if (input.view === "history") return history(actor, input, result);
  const where = itemFilter(actor.workspaceId, input);
  result.total = await db.task.count({ where });
  result.items = await items(where, input.offset, input.limit);
  while (Buffer.byteLength(JSON.stringify(result.items)) > 80 * 1024) result.items.pop();
  result.nextOffset = input.offset + result.items.length < result.total ? input.offset + result.items.length : null;
  return result;
}

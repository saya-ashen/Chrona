import { db } from "@chrona/db";
import { LIBRARY_LIMITS, type LibraryAction, type LibraryChange } from "@chrona/contracts/library";
import { WorkResultError } from "../results/access";
import { libraryNameKey, scopedFolder, scopedGroup, scopedLibraryTask, type LibraryActor } from "./access";

async function createFolder(actor: LibraryActor, groupId: string, name: string, description: string, changes: LibraryChange[]) {
  const group = await scopedGroup(actor, groupId), nameKey = libraryNameKey(name);
  const existing = await db.libraryFolder.findUnique({ where: { groupId_nameKey: { groupId, nameKey } } });
  if (existing) return existing;
  if (!actor.isOwner && !group.allowAgentFolders) throw new WorkResultError("FORBIDDEN", "This group does not allow Agent-created folders");
  if (await db.libraryFolder.count({ where: { groupId } }) >= LIBRARY_LIMITS.foldersPerGroup) throw new WorkResultError("PRECONDITION_FAILED", "Folder limit reached in this group");
  const folder = await db.libraryFolder.create({ data: { groupId, name, nameKey, description } });
  changes.push({ kind: "folder_created", groupId, groupName: group.name, folderId: folder.id, folderName: name });
  return folder;
}
type Placement = Extract<LibraryAction, { type: "assign" }>["placements"][number];
type Previous = Awaited<ReturnType<typeof priorPlacement>>;
function priorFolderName(previous: Previous) { return previous?.folder?.name ?? null; }
function priorPlacement(taskId: string, groupId: string) { return db.libraryAssignment.findUnique({ where: { taskId_groupId: { taskId, groupId } }, include: { folder: true } }); }
function preserveManualChoice(actor: LibraryActor, p: Placement, previous: Previous) {
  if (p.protect !== undefined && !actor.isOwner) throw new WorkResultError("FORBIDDEN", "Only the owner can change manual-choice protection");
  if (!previous?.protected || actor.isOwner) return false;
  const same = p.destination.type === "folder" ? p.destination.folderId === previous.folderId : p.destination.type === "unclassified" && previous.folderId === null;
  if (!same) throw new WorkResultError("PRECONDITION_FAILED", "Manual classification is protected; ask the owner to change it");
  return true;
}
async function destinationFolder(actor: LibraryActor, p: Placement, changes: LibraryChange[]) {
  let folder = null;
  if (p.destination.type === "folder") folder = await scopedFolder(actor, p.destination.folderId);
  if (p.destination.type === "create") folder = await createFolder(actor, p.groupId, p.destination.name, p.destination.description, changes);
  if (folder && folder.groupId !== p.groupId) throw new WorkResultError("NOT_FOUND", "Folder does not belong to the selected group");
  return folder;
}
async function assign(actor: LibraryActor, action: Extract<LibraryAction, { type: "assign" }>, changes: LibraryChange[]) {
  await scopedLibraryTask(actor, action.taskId);
  for (const p of action.placements) {
    const group = await scopedGroup(actor, p.groupId), previous = await priorPlacement(action.taskId, p.groupId);
    // Refuse before resolving/creating destinations, including protected unclassified choices.
    if (preserveManualChoice(actor, p, previous)) {
      changes.push({ kind: "placement_preserved", groupId: group.id, groupName: group.name, folderId: previous!.folderId, folderName: priorFolderName(previous), protected: true });
      continue;
    }
    const folder = await destinationFolder(actor, p, changes);
    const data = { folderId: folder?.id ?? null, protected: actor.isOwner ? p.protect ?? true : false, actorKey: actor.actorKey };
    await db.libraryAssignment.upsert({ where: { taskId_groupId: { taskId: action.taskId, groupId: group.id } }, create: { taskId: action.taskId, groupId: group.id, ...data }, update: data });
    changes.push({ kind: "classified", groupId: group.id, groupName: group.name, folderId: data.folderId, folderName: folder?.name ?? null, previousFolderName: priorFolderName(previous), protected: data.protected });
  }
}
async function groupAction(actor: LibraryActor, action: Extract<LibraryAction, { type: "group_create" | "group_update" | "group_delete" }>, changes: LibraryChange[]) {
  if (action.type === "group_delete") {
    const group = await scopedGroup(actor, action.groupId);
    await db.libraryGroup.delete({ where: { id: group.id } });
    changes.push({ kind: "group_deleted", groupId: group.id, groupName: group.name }); return;
  }
  const nameKey = libraryNameKey(action.name);
  const duplicate = await db.libraryGroup.findUnique({ where: { workspaceId_nameKey: { workspaceId: actor.workspaceId, nameKey } } });
  if (duplicate && (action.type === "group_create" || duplicate.id !== action.groupId)) throw new WorkResultError("PRECONDITION_FAILED", "A classification group with this name already exists");
  const data = { name: action.name, nameKey, instructions: action.instructions, allowAgentFolders: action.allowAgentFolders };
  if (action.type === "group_create") {
    if (await db.libraryGroup.count({ where: { workspaceId: actor.workspaceId } }) >= LIBRARY_LIMITS.groups) throw new WorkResultError("PRECONDITION_FAILED", "Classification group limit reached");
    const group = await db.libraryGroup.create({ data: { workspaceId: actor.workspaceId, ...data } });
    changes.push({ kind: "group_created", groupId: group.id, groupName: group.name });
  } else {
    await scopedGroup(actor, action.groupId);
    await db.libraryGroup.update({ where: { id: action.groupId }, data });
    changes.push({ kind: "group_updated", groupId: action.groupId, groupName: action.name });
  }
}
export async function applyLibraryAction(actor: LibraryActor, action: LibraryAction): Promise<LibraryChange[]> {
  const changes: LibraryChange[] = [];
  if (action.type === "assign") await assign(actor, action, changes);
  else if (action.type === "group_create" || action.type === "group_update" || action.type === "group_delete") await groupAction(actor, action, changes);
  else if (action.type === "folder_create") {
    const folder = await createFolder(actor, action.groupId, action.name, action.description, changes);
    if (!changes.length) changes.push({ kind: "folder_reused", groupId: folder.groupId, groupName: (await scopedGroup(actor, folder.groupId)).name, folderId: folder.id, folderName: folder.name });
  } else {
    const folder = await scopedFolder(actor, action.folderId);
    if (action.type === "folder_delete") await db.libraryFolder.delete({ where: { id: folder.id } });
    else {
      const nameKey = libraryNameKey(action.name);
      const duplicate = await db.libraryFolder.findUnique({ where: { groupId_nameKey: { groupId: folder.groupId, nameKey } } });
      if (duplicate && duplicate.id !== folder.id) throw new WorkResultError("PRECONDITION_FAILED", "A folder with this name already exists in the group");
      await db.libraryFolder.update({ where: { id: folder.id }, data: { name: action.name, nameKey, description: action.description } });
    }
    changes.push({ kind: action.type === "folder_delete" ? "folder_deleted" : "folder_updated", groupId: folder.groupId, groupName: folder.group.name, folderId: folder.id, folderName: action.type === "folder_update" ? action.name : folder.name });
  }
  return changes;
}

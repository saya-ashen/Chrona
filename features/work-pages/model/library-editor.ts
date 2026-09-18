import type { LibraryAction, LibraryFolder, LibraryGroup, LibraryView } from "@chrona/contracts";
export type LibraryEditor = { kind: "group"; group?: LibraryGroup } | { kind: "folder"; groupId: string; folder?: LibraryFolder };
export type LibraryEditorValues = { name: string; details: string; allowAgent: boolean };
export function editorCurrent(editor: LibraryEditor, data: LibraryView) {
  const group = editor.kind === "group" ? data.groups.find(g => g.id === editor.group?.id) : undefined;
  const folder = editor.kind === "folder" ? data.folders.find(f => f.id === editor.folder?.id) : undefined;
  return { name: group?.name ?? folder?.name ?? "", details: group?.instructions ?? folder?.description ?? "", allowAgent: group ? group.allowAgentFolders : true };
}
export function editorExisting(editor: LibraryEditor) { return editor.kind === "group" ? !!editor.group : !!editor.folder; }
export function editorCanWrite(editor: LibraryEditor, data: LibraryView | null) {
  if (!data) return false;
  return editor.kind === "group" || editorExisting(editor) ? data.canConfigure : data.canOrganize;
}
export function editorAction(editor: LibraryEditor, value: LibraryEditorValues): LibraryAction {
  const { name, details, allowAgent } = value;
  if (editor.kind === "folder") return editor.folder ? { type: "folder_update", folderId: editor.folder.id, name, description: details } : { type: "folder_create", groupId: editor.groupId, name, description: details };
  return editor.group ? { type: "group_update", groupId: editor.group.id, name, instructions: details, allowAgentFolders: allowAgent } : { type: "group_create", name, instructions: details, allowAgentFolders: allowAgent };
}
export function editorDeletion(editor: LibraryEditor): LibraryAction | null {
  if (editor.kind === "folder") return editor.folder ? { type: "folder_delete", folderId: editor.folder.id } : null;
  return editor.group ? { type: "group_delete", groupId: editor.group.id } : null;
}
export function editorTitle(editor: LibraryEditor) {
  if (editor.kind === "group") return editor.group ? "manageGroup" : "newGroup";
  return editor.folder ? "editFolder" : "newFolder";
}

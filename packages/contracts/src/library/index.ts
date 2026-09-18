import { z } from "zod";

export const LIBRARY_SCOPES = ["library:read", "library:organize", "library:configure"] as const;
export const LIBRARY_LIMITS = { groups: 32, foldersPerGroup: 100, commands: 20000, requestBytes: 32 * 1024 } as const;
const id = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(100).refine((v) => [...v].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127), "Control characters are not allowed");
const folder = z.object({ name, description: z.string().trim().max(300).default("") }).strict();
export const libraryReadSchema = z.object({
  view: z.enum(["catalog", "browse", "item", "history"]).default("browse"),
  groupId: id.optional(), folderId: id.optional(), unclassified: z.boolean().default(false), taskId: id.optional(),
  query: z.string().trim().max(200).optional(), offset: z.number().int().min(0).max(1000000).default(0), limit: z.number().int().min(1).max(50).default(20),
}).strict().superRefine((v, ctx) => {
  if ((v.folderId || v.unclassified) && !v.groupId) ctx.addIssue({ code: "custom", message: "Folder browsing requires a group" });
  if (v.folderId && v.unclassified) ctx.addIssue({ code: "custom", message: "Choose a folder or unclassified, not both" });
  if (v.view === "item" && !v.taskId) ctx.addIssue({ code: "custom", message: "Item view requires taskId" });
});
const placement = z.object({ groupId: id, destination: z.discriminatedUnion("type", [
  z.object({ type: z.literal("folder"), folderId: id }).strict(),
  z.object({ type: z.literal("create"), ...folder.shape }).strict(),
  z.object({ type: z.literal("unclassified") }).strict(),
]), protect: z.boolean().optional().describe("Owner only. Manual choices are protected by default; external organizers cannot override or unlock them.") }).strict();
export const libraryWriteSchema = z.object({
  requestId: z.string().uuid(), expectedRevision: z.string().max(200).regex(/^library-v1:[A-Za-z0-9_-]+:\d+$/),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("group_create"), name, instructions: z.string().trim().max(2000).default(""), allowAgentFolders: z.boolean().default(true) }).strict(),
    z.object({ type: z.literal("group_update"), groupId: id, name, instructions: z.string().trim().max(2000), allowAgentFolders: z.boolean() }).strict(),
    z.object({ type: z.literal("group_delete"), groupId: id }).strict(),
    z.object({ type: z.literal("folder_create"), groupId: id, ...folder.shape }).strict(),
    z.object({ type: z.literal("folder_update"), folderId: id, ...folder.shape }).strict(),
    z.object({ type: z.literal("folder_delete"), folderId: id }).strict(),
    z.object({ type: z.literal("assign"), taskId: id, placements: z.array(placement).min(1).max(LIBRARY_LIMITS.groups).refine((v) => new Set(v.map((p) => p.groupId)).size === v.length, "Only one placement per group") }).strict(),
  ]),
}).strict();
export type LibraryRead = z.infer<typeof libraryReadSchema>;
export type LibraryWrite = z.infer<typeof libraryWriteSchema>;
export type LibraryAction = LibraryWrite["action"];
export type LibraryGroup = { id: string; name: string; instructions: string; allowAgentFolders: boolean; folderCount: number; classifiedCount: number; unclassifiedCount: number };
export type LibraryFolder = { id: string; groupId: string; name: string; description: string; count: number };
export type LibraryPlacement = { groupId: string; groupName: string; folderId: string | null; folderName: string | null; protected: boolean; actorKey: string };
export type LibraryItem = { id: string; title: string; description: string | null; taskExecutionMode: string; status: string; placements: LibraryPlacement[] };
export type LibraryChange = { kind: string; groupId?: string; groupName?: string; folderId?: string | null; folderName?: string | null; previousFolderName?: string | null; protected?: boolean };
export type LibraryReceipt = { commandId: string; revision: string; taskId: string | null; actorKey: string; recordedAt: string; changes: LibraryChange[]; contentChanged: false; executionStarted: false };
export type LibraryWriteResult = { replayed: boolean; receipt: LibraryReceipt };
export type LibraryView = {
  revision: string; canOrganize: boolean; canConfigure: boolean; isOwner: boolean; writesEnabled: boolean;
  groups: LibraryGroup[]; folders: LibraryFolder[]; totalItems: number;
  items: LibraryItem[]; total: number; nextOffset: number | null; history: LibraryReceipt[];
};

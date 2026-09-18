import { z } from "zod";
import { pageKey, pageAnswersSchema } from "@chrona/ui-protocol/work-pages";
import { resultScopeSchema } from "./files";
export const PAGE_SCOPES = ["pages:read", "pages:write"] as const;
export const PAGE_ENTRY_LIMIT = 2000;
export const PAGE_WORKSPACE_ENTRY_LIMIT = 20000;
export const pageRevisionSchema = z.string().max(200).regex(/^page-input-v1:[A-Za-z0-9_-]+:[0-9]+$/);
export const pageReadSchema = resultScopeSchema.extend({
  kind: z.enum(["note", "response"]).optional(),
  view: z.enum(["current", "history"]).default("current"), versionId: z.string().min(1).max(128).optional(),
  offset: z.number().int().min(0).max(PAGE_ENTRY_LIMIT).default(0), limit: z.number().int().min(1).max(20).default(10),
}).strict();
export const pageValidateSchema = resultScopeSchema.extend({ page: z.unknown() }).strict();
export const pageWriteSchema = resultScopeSchema.extend({
  requestId: z.string().uuid(), expectedRevision: pageRevisionSchema.nullable(),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("note"), noteId: z.string().uuid(), text: z.string().max(8000) }).strict(),
    z.object({ type: z.literal("respond"), versionId: z.string().min(1).max(128), formKey: pageKey, answers: pageAnswersSchema }).strict(),
  ]),
}).strict();
export type PageWrite = z.infer<typeof pageWriteSchema>;
export type PageRead = z.infer<typeof pageReadSchema>;
export type PageEntry = {
  id: string; revision: number; kind: "note" | "response"; entryKey: string; versionId: string | null;
  formKey: string | null; content: { text?: string; answers?: z.infer<typeof pageAnswersSchema> };
  actorKey: string; createdAt: string;
};
export type PageInputsView = {
  revision: string | null; headVersionId: string | null; canRespond: boolean;
  entries: PageEntry[]; total: number; nextOffset: number | null; view: "current" | "history";
};

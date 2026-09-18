import { z } from "zod";
import { resultIdSchema } from "./work-result";

export const ARTIFACT_SCOPES = ["artifacts:read", "artifacts:write"] as const;
export const RESULT_FILE_CHUNK_BYTES = 32 * 1024;
export const RESULT_FILE_MAX_BYTES = 8 * 1024 * 1024;
export const RESULT_VERSION_FILE_BYTES = 32 * 1024 * 1024;
export const RESULT_WORKSPACE_FILE_BYTES = 256 * 1024 * 1024;
export const RESULT_WORKSPACE_UPLOADS = 1024;
export const RESULT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const resultScopeSchema = z.object({ taskId: resultIdSchema, occurrenceId: resultIdSchema.nullable().default(null) }).strict();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const resultFilenameSchema = z.string().min(1).max(200).regex(/^[^/\\]+$/).refine((v) => [...v].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) && v !== "." && v !== "..", "A file name is required, not a path");
const mime = z.string().min(1).max(100).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/);
const offset = z.number().int().min(0).max(RESULT_FILE_MAX_BYTES);
export const resultFileSchema = resultScopeSchema.extend({ action: z.discriminatedUnion("type", [
  z.object({ type: z.literal("begin"), requestId: z.uuid(), filename: resultFilenameSchema, mimeType: mime, sizeBytes: z.number().int().min(0).max(RESULT_FILE_MAX_BYTES), sha256 }).strict(),
  z.object({ type: z.literal("write"), uploadId: resultIdSchema, offset, sha256, base64: z.string().min(4).max(43_692).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict(),
  z.object({ type: z.literal("finish"), uploadId: resultIdSchema }).strict(),
  z.object({ type: z.literal("status"), uploadId: resultIdSchema }).strict(),
  z.object({ type: z.literal("cancel"), uploadId: resultIdSchema }).strict(),
  z.object({ type: z.literal("read"), versionId: resultIdSchema, artifactRef: z.string().regex(/^AF[0-9A-F]{12}$/), offset: offset.default(0), limit: z.number().int().min(1).max(RESULT_FILE_CHUNK_BYTES).default(RESULT_FILE_CHUNK_BYTES) }).strict(),
]) }).strict();
export type ResultFileInput = z.infer<typeof resultFileSchema>;
export type ResultFileAction<T extends ResultFileInput["action"]["type"]> = Extract<ResultFileInput["action"], { type: T }>;
export type ResultUploadStatus = {
  uploadId: string; resultId: string; editRevision: string; status: "open" | "completed" | "cancelled" | "expired";
  receivedBytes: number; sizeBytes: number; sha256: string; filename: string; mimeType: string; expiresAt: string;
  artifactRef: string | null; artifactAvailable: boolean; chunkBytes: number;
};
export type ResultFileRead = { artifactRef: string; versionId: string; filename: string; mimeType: string; sizeBytes: number; sha256: string; offset: number; base64: string; nextOffset: number | null };

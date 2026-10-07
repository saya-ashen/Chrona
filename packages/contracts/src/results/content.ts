import { z } from "zod";

/** Source-independent semantic primitives shared by result consumers.
 * These validate content, not provenance, artifact access, or review authority.
 * Input limits and authenticated ownership belong to the enclosing protocol.
 * Preserve existing wire behavior while managed execution adopts this module.
 */
export const deliverableKindSchema = z.enum([
  "document",
  "table",
  "dataset",
  "image",
  "archive",
  "code",
  "other",
]);

export const deliverablePresentationSchema = z.object({
  primary: z.enum(["table", "file", "document", "image"]),
  allowDownload: z.boolean(),
}).strict();

export const resultContributionSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/i),
  title: z.string().min(1).optional(),
  content: z.string().min(1),
  importance: z.enum(["primary", "supporting"]).optional(),
}).strict();

export const resultEvidenceSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/i),
  summary: z.string().min(1),
  artifactRef: z.string().regex(/^AF[0-9A-F]{12}$/).optional(),
}).strict();

export type ResultContributionContent = z.infer<typeof resultContributionSchema>;

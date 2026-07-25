import { z } from "zod";

const deliverableKindSchema = z.enum([
  "document",
  "table",
  "dataset",
  "image",
  "archive",
  "code",
  "other",
]);
const deliverablePresentationSchema = z.object({
  primary: z.enum(["table", "file", "document", "image"]),
  allowDownload: z.boolean(),
}).strict();
const generatedDeliverableSourceSchema = z.object({
  type: z.literal("generated_file"),
  uri: z.string().startsWith("generated://"),
}).strict();
const existingDeliverableSourceSchema = z.object({
  type: z.literal("existing_artifact"),
  artifactRef: z.string().regex(/^AF[0-9A-F]{12}$/),
}).strict();

export const nodeDeliverableSchema = z.object({
  deliverableKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/i),
  title: z.string().min(1),
  kind: deliverableKindSchema,
  source: z.discriminatedUnion("type", [
    generatedDeliverableSourceSchema,
    existingDeliverableSourceSchema,
  ]),
  summary: z.string().min(1).optional(),
  presentation: deliverablePresentationSchema.optional(),
  placement: z.enum(["primary", "supporting", "evidence"]).optional(),
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

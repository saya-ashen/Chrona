import { z } from "zod";
import {
  deliverableKindSchema,
  deliverablePresentationSchema,
} from "../results/content";

// API composition shares semantic content with non-execution consumers.
// Generated-file declarations remain a managed-execution protocol here.
export { resultContributionSchema, resultEvidenceSchema } from "../results/content";
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

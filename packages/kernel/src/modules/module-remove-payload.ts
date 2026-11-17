import { z } from "zod";

/** A once-only removal approval binds the exact app identity and selected version. */
export const moduleRemovePayloadSchema = z.object({ kind: z.literal("module_remove"), moduleId: z.string(), hash: z.string(), name: z.string() }).strict();

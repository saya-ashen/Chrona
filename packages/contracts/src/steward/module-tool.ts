import { z } from "zod";
import { moduleOutputSchema } from "./module-output";
import { moduleToolParameterSchema } from "./module-input";

export const slug = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);
/** Tool audience; current approved authority:"owner" applications act for owner. */
export const TOOL_VISIBILITY = ["provider", "owner", "modules", "kernel"] as const;
export const moduleToolSchema = z.object({
  name: slug, description: z.string().min(1).max(500),
  /** Every callable tool declares its output contract. */
  output: moduleOutputSchema,
  /** Descriptive metadata grants no authority or replay safety. */
  examples: z.array(z.object({ description: z.string().max(300).optional(), args: z.record(z.string(), z.json()), result: z.json().optional() }).strict()).max(3).optional(),
  sideEffects: z.array(z.string().min(1).max(300)).max(8).optional(),
  errors: z.array(z.object({ code: z.string().min(1).max(80), description: z.string().min(1).max(300), recovery: z.string().min(1).max(300) }).strict()).max(8).optional(),
  parameters: z.object({ type: z.literal("object"), properties: z.record(slug, moduleToolParameterSchema).default({}), required: z.array(slug).default([]) }).strict(),
  visibility: z.array(z.enum(TOOL_VISIBILITY)).min(1).max(TOOL_VISIBILITY.length).default(["provider", "owner"]),
  idempotent: z.boolean().default(false),
}).strict();
export type ModuleTool = z.infer<typeof moduleToolSchema>;

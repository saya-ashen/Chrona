import { z } from "zod";

const jsonType = z.enum(["object", "array", "string", "number", "integer", "boolean", "null"]);
/** Deliberately the same structural subset supported by generated call types; no refs or executable extensions. */
const shape: z.ZodType = z.lazy(() => z.object({
  type: z.union([jsonType, z.array(jsonType).min(1)]).optional(),
  title: z.string().optional(), description: z.string().optional(),
  properties: z.record(z.string(), shape).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.union([z.boolean(), shape]).optional(),
  items: shape.optional(),
  enum: z.array(z.json()).min(1).optional(), const: z.json().optional(),
  anyOf: z.array(shape).min(1).optional(), allOf: z.array(shape).min(1).optional(),
}).strict().refine(schema => !schema.required || schema.required.every(key => Object.hasOwn(schema.properties ?? {}, key)),
  "Required fields must be declared in properties in the same schema"));

const compiled = new WeakMap<Record<string, unknown>, z.ZodType>();
/** A parsed manifest retains its output object, so validation, reference and routing can reuse the compilation. */
export function compileModuleOutput(schema: Record<string, unknown>): z.ZodType {
  const known = compiled.get(schema);
  if (known) return known;
  const result = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  compiled.set(schema, result);
  return result;
}

export const moduleOutputSchema = z.record(z.string(), z.json()).superRefine((schema, ctx) => {
  if (JSON.stringify(schema).length > 8000) {
    ctx.addIssue({ code: "custom", message: "Tool output schema exceeds 8000 characters" });
    return;
  }
  if (!shape.safeParse(schema).success) {
    ctx.addIssue({ code: "custom", message: "Tool output schema uses unsupported structure or keywords" });
    return;
  }
  try { compileModuleOutput(schema); }
  catch { ctx.addIssue({ code: "custom", message: "Tool output schema cannot be compiled" }); }
});

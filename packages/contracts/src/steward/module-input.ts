import { z } from "zod";

export type ModuleToolParameter =
  | { type: "string"; description?: string; enum?: string[] }
  | { type: "number" | "boolean"; description?: string }
  | { type: "array"; description?: string; items: ModuleToolParameter }
  | { type: "object"; description?: string; properties: Record<string, ModuleToolParameter>; required?: string[]; additionalProperties?: boolean };

const description = z.string().max(300).optional();
const parameter: z.ZodType<ModuleToolParameter> = z.lazy(() => z.union([
  z.object({ type: z.literal("string"), description, enum: z.array(z.string().max(100)).min(1).max(20).optional() }).strict(),
  z.object({ type: z.enum(["number", "boolean"]), description }).strict(),
  z.object({ type: z.literal("array"), description, items: parameter }).strict(),
  z.object({ type: z.literal("object"), description, properties: z.record(z.string().min(1).max(100), parameter), required: z.array(z.string().min(1).max(100)).default([]), additionalProperties: z.boolean().default(false) }).strict()
    .refine(value => value.required.every(key => Object.hasOwn(value.properties, key)), "Required fields must be declared in properties"),
]));

/** Bound recursive input before parsing so malformed deeply nested manifests fail normally. */
export const moduleToolParameterSchema = z.unknown().superRefine((value, ctx) => {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 1000 || depth > 24) return false;
    if (item && typeof item === "object") return Object.values(item).every(child => visit(child, depth + 1));
    return true;
  };
  if (!visit(value, 0)) ctx.addIssue({ code: "custom", message: "Tool parameter schema is too deeply nested or too large", fatal: true });
}).pipe(parameter);

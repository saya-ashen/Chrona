import { z } from "zod";

export type ModuleToolParameter =
  | { anyOf: ModuleToolParameter[]; type?: never; description?: string }
  | { type: ("string" | "number" | "boolean" | "null")[]; description?: string }
  | { type: "string"; description?: string; enum?: string[] }
  | { type: "number" | "integer"; description?: string; minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number }
  | { type: "boolean" | "null"; description?: string }
  | { type: "array"; description?: string; items: ModuleToolParameter }
  | { type: "object"; description?: string; properties: Record<string, ModuleToolParameter>; required?: string[]; additionalProperties?: boolean };

const description = z.string().max(300).optional();
const parameter: z.ZodType<ModuleToolParameter> = z.lazy(() => z.union([
  z.object({ anyOf: z.array(parameter).min(1).max(10), description }).strict(),
  z.object({ type: z.array(z.enum(["string", "number", "boolean", "null"])).min(2).max(4), description }).strict(),
  z.object({ type: z.literal("string"), description, enum: z.array(z.string().max(100)).min(1).optional() }).strict(),
  z.object({ type: z.enum(["number", "integer"]), description, minimum: z.number().optional(), maximum: z.number().optional(),
    exclusiveMinimum: z.number().optional(), exclusiveMaximum: z.number().optional() }).strict(),
  z.object({ type: z.enum(["boolean", "null"]), description }).strict(),
  z.object({ type: z.literal("array"), description, items: parameter }).strict(),
  z.object({ type: z.literal("object"), description, properties: z.record(z.string().min(1).max(100), parameter), required: z.array(z.string().min(1).max(100)).default([]), additionalProperties: z.boolean().default(false) }).strict()
    .refine(value => value.required.every(key => Object.hasOwn(value.properties, key)), "Required fields must be declared in properties"),
]));

/** Bound recursive input before parsing so malformed deeply nested manifests fail normally. */
const boundedInput = z.unknown().superRefine((value, ctx) => {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 1000 || depth > 24) return false;
    if (item && typeof item === "object") return Object.values(item).every(child => visit(child, depth + 1));
    return true;
  };
  if (!visit(value, 0) || new TextEncoder().encode(JSON.stringify(value)).byteLength > 65_536) ctx.addIssue({ code: "custom", message: "Tool parameter schema is too deeply nested or too large", fatal: true });
});
export const moduleToolParameterSchema = boundedInput.pipe(parameter);
export const moduleToolParametersSchema = boundedInput.pipe(z.object({
  type: z.literal("object"), properties: z.record(z.string().min(1).max(100), parameter).default({}),
  required: z.array(z.string().min(1).max(100)).default([]),
}).strict().refine(value => value.required.every(key => Object.hasOwn(value.properties, key)), "Required fields must be declared in properties"));

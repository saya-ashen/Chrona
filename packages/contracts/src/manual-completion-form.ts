import { z } from "zod";

const manualCompletionFormOptionSchema = z
  .object({
    value: z.string().trim().min(1).max(128),
    label: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(500).optional(),
    recommended: z.boolean().optional(),
  })
  .strict();

export const manualCompletionFormFieldSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    name: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/, "field name must be a stable identifier").max(64),
    label: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(500).optional(),
    multiline: z.boolean().optional(),
    required: z.boolean().optional(),
    placeholder: z.string().trim().min(1).max(500).optional(),
  }).strict(),
  z.object({
    kind: z.literal("choice"),
    name: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/, "field name must be a stable identifier").max(64),
    label: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(500).optional(),
    selection: z.enum(["single", "multiple"]),
    options: z.array(manualCompletionFormOptionSchema).min(2).max(32),
    required: z.boolean().optional(),
    minSelections: z.number().int().min(0).max(32).optional(),
    maxSelections: z.number().int().min(1).max(32).optional(),
  }).strict(),
  z.object({
    kind: z.literal("boolean"),
    name: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/, "field name must be a stable identifier").max(64),
    label: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(500).optional(),
    required: z.boolean().optional(),
  }).strict(),
]);

const SENSITIVE_MANUAL_FORM_FIELD = /(?:password|passcode|api[ _-]?key|secret|access[ _-]?token|credential|permission|authorization|密码|口令|密钥|令牌|凭据|权限|授权)/i;

export const manualCompletionFormSchema = z
  .object({
    instructions: z.string().trim().min(1).max(2_000),
    submitLabel: z.string().trim().min(1).max(120).optional(),
    inputFields: z.array(manualCompletionFormFieldSchema).min(1).max(12),
  })
  .strict()
  .superRefine((form, context) => {
    const names = new Set<string>();
    form.inputFields.forEach((field, index) => {
      if (names.has(field.name)) {
        context.addIssue({ code: "custom", path: ["inputFields", index, "name"], message: "field names must be unique" });
      }
      names.add(field.name);
      if (SENSITIVE_MANUAL_FORM_FIELD.test(`${field.name} ${field.label} ${field.description ?? ""}`)) {
        context.addIssue({ code: "custom", path: ["inputFields", index], message: "manual completion forms must not request secrets, credentials, permissions, or authorization decisions" });
      }
      if (field.kind === "choice") validateChoiceField(field, index, context);
    });
  });

function validateChoiceField(
  field: Extract<ManualCompletionFormField, { kind: "choice" }>,
  index: number,
  context: z.RefinementCtx,
) {
  const values = field.options.map((option) => option.value);
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path: ["inputFields", index, "options"], message: "choice option values must be unique" });
  }
  if (field.minSelections !== undefined && field.maxSelections !== undefined && field.minSelections > field.maxSelections) {
    context.addIssue({ code: "custom", path: ["inputFields", index], message: "minSelections cannot exceed maxSelections" });
  }
  if (field.maxSelections !== undefined && field.maxSelections > field.options.length) {
    context.addIssue({ code: "custom", path: ["inputFields", index, "maxSelections"], message: "maxSelections cannot exceed the option count" });
  }
}

export type ManualCompletionFormField = z.infer<typeof manualCompletionFormFieldSchema>;
export type ManualCompletionForm = z.infer<typeof manualCompletionFormSchema>;

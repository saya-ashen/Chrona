import { z } from "zod";

/** A literal-only subset of json-render. No events, expressions, state paths or URLs to execute. */
export const pageKey = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/).refine((v) => !["constructor", "prototype", "__proto__"].includes(v));
const text = z.string().max(8000);
export const pageValueSchema = z.union([text, z.number().finite(), z.boolean(), z.null()]);
export const pageAnswerSchema = z.union([text, z.number().finite(), z.boolean(), z.array(z.string().max(200)).max(30)]);
export const pageAnswersSchema = z.record(pageKey, pageAnswerSchema);
export type PageAnswers = z.infer<typeof pageAnswersSchema>;
const option = z.object({ value: z.string().min(1).max(200), label: z.string().min(1).max(200) }).strict();
export const pageFieldSchema = z.object({
  key: pageKey, label: z.string().min(1).max(200), help: z.string().max(1000).optional(),
  type: z.enum(["text", "textarea", "number", "select", "multiselect", "checkbox", "date"]), required: z.boolean().default(false),
  options: z.array(option).min(1).max(30).optional(), min: z.number().finite().optional(), max: z.number().finite().optional(),
  when: z.object({ field: pageKey, equals: z.union([z.string().max(200), z.number().finite(), z.boolean()]) }).strict().optional(),
}).strict();
export const pageFormSchema = z.object({ title: z.string().min(1).max(200), description: z.string().max(2000).optional(), fields: z.array(pageFieldSchema).min(1).max(30) }).strict().superRefine((form, ctx) => {
  const seen = new Set<string>();
  for (const [i, field] of form.fields.entries()) {
    const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["fields", i], message });
    if (seen.has(field.key)) issue("Duplicate field key");
    if (field.when && !seen.has(field.when.field)) issue("Conditions must reference an earlier field");
    validateFieldDefinition(field, issue);
    seen.add(field.key);
  }
});
export type PageForm = z.infer<typeof pageFormSchema>;
export type PageField = PageForm["fields"][number];
function validateFieldDefinition(field: z.infer<typeof pageFieldSchema>, issue: (message: string) => void) {
  if (["select", "multiselect"].includes(field.type) !== Boolean(field.options)) issue("Only choice fields require options");
  if (field.options && new Set(field.options.map((o) => o.value)).size !== field.options.length) issue("Duplicate choice value");
  if ((field.min !== undefined || field.max !== undefined) && field.type !== "number") issue("Bounds are numeric only");
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) issue("Invalid numeric bounds");
}
function lookup<T>(map: Partial<Record<string, T>>, key: string): T | undefined { return map[key]; }
const column = z.object({ key: pageKey, label: z.string().min(1).max(200), kind: z.enum(["text", "number"]).default("text") }).strict();
export const pageDatasetSchema = z.object({ columns: z.array(column).min(1).max(12), rows: z.array(z.record(pageKey, pageValueSchema)).max(200) }).strict().superRefine((data, ctx) => {
  const keys = new Set(data.columns.map((c) => c.key));
  if (keys.size !== data.columns.length) ctx.addIssue({ code: "custom", message: "Duplicate column key" });
  data.rows.forEach((row, i) => {
    for (const key of Object.keys(row)) if (!keys.has(key)) ctx.addIssue({ code: "custom", path: ["rows", i, key], message: "Unknown column" });
    for (const col of data.columns) if (col.kind === "number" && row[col.key] != null && typeof row[col.key] !== "number") ctx.addIssue({ code: "custom", path: ["rows", i, col.key], message: "Expected number" });
  });
});
export type PageDataset = z.infer<typeof pageDatasetSchema>;
export const safePageUrl = z.string().max(2048).url().refine((value) => {
  try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}, "Only public-facing HTTP(S) links without credentials; never executed by Chrona");
export const workPageProps = {
  Section: z.object({ title: z.string().max(200).optional(), summary: z.string().max(1000).optional(), collapsed: z.boolean().default(false), layout: z.enum(["stack", "columns"]).default("stack") }).strict(),
  Text: z.object({ text, tone: z.enum(["normal", "muted", "lead"]).default("normal") }).strict(),
  Callout: z.object({ title: z.string().max(200), text, tone: z.enum(["info", "attention"]).default("info") }).strict(),
  Table: z.object({ dataset: pageKey, title: z.string().max(200).optional(), searchable: z.boolean().default(true) }).strict(),
  Comparison: z.object({ dataset: pageKey, title: z.string().max(200).optional() }).strict(),
  Metric: z.object({ label: z.string().max(200), dataset: pageKey, column: pageKey.optional(), calculation: z.enum(["sum", "count", "min", "max"]), suffix: z.string().max(30).optional() }).strict(),
  Link: z.object({ label: z.string().min(1).max(200), href: safePageUrl, description: z.string().max(1000).optional() }).strict(),
  Form: z.object({ form: pageKey }).strict(),
};
const leaf = { children: z.array(pageKey).max(0).optional() };
export const workPageElementSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Section"), props: workPageProps.Section, children: z.array(pageKey).max(64).default([]) }).strict(),
  z.object({ type: z.literal("Text"), props: workPageProps.Text, ...leaf }).strict(),
  z.object({ type: z.literal("Callout"), props: workPageProps.Callout, ...leaf }).strict(),
  z.object({ type: z.literal("Table"), props: workPageProps.Table, ...leaf }).strict(),
  z.object({ type: z.literal("Comparison"), props: workPageProps.Comparison, ...leaf }).strict(),
  z.object({ type: z.literal("Metric"), props: workPageProps.Metric, ...leaf }).strict(),
  z.object({ type: z.literal("Link"), props: workPageProps.Link, ...leaf }).strict(),
  z.object({ type: z.literal("Form"), props: workPageProps.Form, ...leaf }).strict(),
]);
export const workPageSchema = z.object({
  schemaVersion: z.literal(1), root: pageKey,
  elements: z.record(pageKey, workPageElementSchema).refine((v) => Object.keys(v).length <= 128),
  datasets: z.record(pageKey, pageDatasetSchema).refine((v) => Object.keys(v).length <= 12).default({}),
  forms: z.record(pageKey, pageFormSchema).refine((v) => Object.keys(v).length <= 8).default({}),
}).strict().superRefine((page, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const seen = new Set<string>(); const forms = new Set<string>();
  function visit(key: string, depth: number) {
    if (depth > 12 || seen.has(key)) { issue("Tree has repeated children, cycle or excessive depth"); return; }
    seen.add(key);
    const node = lookup(page.elements, key);
    if (!node) { issue(`Unknown element: ${key}`); return; }
    if (node.type === "Form") {
      if (!lookup(page.forms, node.props.form) || forms.has(node.props.form)) issue("Form reference missing or repeated");
      forms.add(node.props.form);
    }
    validateDatasetReference(node, page.datasets, issue);
    for (const child of node.children ?? []) visit(child, depth + 1);
  }
  visit(page.root, 0);
  if (seen.size !== Object.keys(page.elements).length) issue("Unreachable elements");
  if (forms.size !== Object.keys(page.forms).length) issue("Unreachable forms");
});
export type WorkPage = z.infer<typeof workPageSchema>;
function validateDatasetReference(node: z.infer<typeof workPageElementSchema>, datasets: Record<string, PageDataset>, issue: (message: string) => void) {
  if (node.type !== "Table" && node.type !== "Comparison" && node.type !== "Metric") return;
  const data = lookup(datasets, node.props.dataset);
  if (!data) { issue("Dataset reference missing"); return; }
  if (node.type === "Metric" && node.props.calculation !== "count" && !data.columns.some((c) => c.key === node.props.column && c.kind === "number")) issue("Metric requires numeric column");
}
function validDate(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function validNumber(value: unknown, field: PageField): boolean {
  return typeof value === "number" && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
}
function validChoice(value: unknown, field: PageField): boolean {
  return typeof value === "string" && Boolean(field.options?.some((o) => o.value === value));
}
function validAnswer(value: PageAnswers[string], field: PageField): boolean {
  switch (field.type) {
    case "text": case "textarea": return typeof value === "string";
    case "date": return validDate(value);
    case "number": return validNumber(value, field);
    case "checkbox": return typeof value === "boolean";
    case "select": return validChoice(value, field);
    case "multiselect": return Array.isArray(value) && new Set(value).size === value.length && value.every((v) => validChoice(v, field));
  }
}

export function visiblePageFields(form: PageForm, answers: PageAnswers): PageField[] {
  const visible = new Set<string>();
  return form.fields.filter((f) => {
    if (f.when && (!visible.has(f.when.field) || answers[f.when.field] !== f.when.equals)) return false;
    visible.add(f.key); return true;
  });
}
/** Server and renderer share validation. Hidden values are not retained in submissions. */
export function validatePageAnswers(form: PageForm, raw: unknown): { answers: PageAnswers; errors: Record<string, string> } {
  const parsed = pageAnswersSchema.safeParse(raw);
  if (!parsed.success) return { answers: {}, errors: { _form: "invalid" } };
  const errors: Record<string, string> = {}; const answers: PageAnswers = {};
  if (Object.keys(parsed.data).some((key) => !form.fields.some((f) => f.key === key))) errors._form = "unknown_field";
  for (const field of visiblePageFields(form, parsed.data)) {
    const value = lookup(parsed.data, field.key);
    const empty = value === undefined || value === "" || (Array.isArray(value) && !value.length);
    if (empty) { if (field.required) errors[field.key] = "required"; continue; }
    if (!validAnswer(value!, field)) errors[field.key] = "invalid"; else answers[field.key] = value!;
  }
  return { answers, errors };
}
export function calculatePageMetric(data: PageDataset, calculation: "sum" | "count" | "min" | "max", column?: string): number | null {
  if (calculation === "count") return data.rows.length;
  const values = data.rows.map((row) => column ? row[column] : null).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!values.length) return null;
  const result = calculation === "sum" ? values.reduce((sum, v) => sum + v, 0) : calculation === "min" ? Math.min(...values) : Math.max(...values);
  return Number.isFinite(result) ? result : null;
}

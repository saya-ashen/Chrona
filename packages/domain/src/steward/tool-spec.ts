import { z } from "zod";

const text = z.string().trim().min(1).max(200);
export const toolSpecSchema = z.object({
  title: text,
  description: z.string().trim().max(2000).optional(),
  fields: z.array(z.object({
    key: text, label: text, type: z.enum(["text", "number", "date", "select"]), required: z.boolean().optional(), options: z.array(text).min(1).optional(),
  }).strict()).min(1).max(50),
  views: z.array(z.union([
    z.object({ kind: z.enum(["table", "list"]), columns: z.array(text).min(1).max(50) }).strict(),
    z.object({ kind: z.literal("trend"), x: text, y: text }).strict(),
  ])).min(1).max(10),
}).strict().superRefine((spec, ctx) => {
  const keys = new Set<string>();
  spec.fields.forEach((field, i) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["fields", i], message: `字段 ${field.key}：${message}` });
    if (keys.has(field.key)) issue("键重复");
    keys.add(field.key);
    if (["__proto__", "constructor", "prototype"].includes(field.key)) issue("键不可使用");
    if (field.type === "select" && !field.options) issue("请选择至少一个 options 选项");
    if (field.type !== "select" && field.options) issue("只有 select 字段可设置 options");
    if (field.options && new Set(field.options).size !== field.options.length) issue("选项重复");
  });
  spec.views.forEach((view, i) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["views", i], message: `视图 ${i + 1}：${message}` });
    if (view.kind === "trend") {
      if (spec.fields.find(f => f.key === view.x)?.type !== "date") issue(`x (${view.x}) 必须引用 date 字段`);
      if (spec.fields.find(f => f.key === view.y)?.type !== "number") issue(`y (${view.y}) 必须引用 number 字段`);
    } else {
      if (new Set(view.columns).size !== view.columns.length) issue("columns 不可重复");
      for (const key of view.columns) if (!keys.has(key)) issue(`columns 引用了不存在的字段 ${key}`);
    }
  });
});
export type ToolSpec = z.infer<typeof toolSpecSchema>;
export function validateToolSpec(input: unknown): { passed: boolean; summary: string; failures: string[] } {
  const result = toolSpecSchema.safeParse(input);
  const failures = result.success ? [] : result.error.issues.map(issue => `${issue.path.join(".") || "面板"}：${issue.code === "custom" ? issue.message : issue.code === "unrecognized_keys" ? "存在不支持的属性" : issue.code === "too_small" ? "不能为空或数量不足" : issue.code === "too_big" ? "长度或数量超出限制" : "类型或格式不正确，请检查字段类型及视图格式"}`);
  return { passed: result.success, summary: result.success ? "面板校验通过" : failures.join("；"), failures };
}

function panelNumber(value: unknown): number {
  if (typeof value === "number") return value;
  return typeof value === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : NaN;
}

function validPanelDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function validatePanelField(field: ToolSpec["fields"][number], value: unknown, output: Record<string, string | number | null>, failures: string[]): void {
  const fail = (reason: string) => failures.push(`字段 ${field.label} (${field.key})：${reason}`);
  if (value === null || value === undefined || typeof value === "string" && !value.trim()) {
    if (field.required) fail("必填");
    else output[field.key] = null;
    return;
  }
  validatePresentPanelField(field, value, output, fail);
}

function validatePresentPanelField(field: ToolSpec["fields"][number], value: unknown, output: Record<string, string | number | null>, fail: (reason: string) => void): void {
  if (field.type === "number") {
    const number = panelNumber(value);
    if (!Number.isFinite(number)) fail("请输入有效数字");
    else output[field.key] = number;
  } else if (typeof value !== "string" || value.length > 2000) fail("请输入不超过 2000 字的文本");
  else if (field.type === "date" && !validPanelDate(value)) fail("请输入有效日期 YYYY-MM-DD");
  else if (field.type === "select" && !field.options?.includes(value)) fail("请选择 options 中的选项");
  else output[field.key] = value;
}

/** Parse only declared fields; never persist unchecked keys or coerced booleans. */
export function validatePanelEntry(spec: ToolSpec, values: unknown) {
  const failures: string[] = [];
  const output: Record<string, string | number | null> = {};
  if (!values || typeof values !== "object" || Array.isArray(values)) return { passed: false, values: output, failures: ["记录必须是字段键值对象"] };
  const input = values as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!spec.fields.some(f => f.key === key)) failures.push(`字段 ${key}：不存在`);
  for (const field of spec.fields) {
    const value = Object.hasOwn(input, field.key) ? input[field.key] : undefined;
    validatePanelField(field, value, output, failures);
  }
  return { passed: failures.length === 0, values: output, failures };
}

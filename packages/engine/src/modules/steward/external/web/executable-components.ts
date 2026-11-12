import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { components as builtins } from "./catalog";
import type { Caller, ModuleState } from "./pages";

const NAME = /^[A-Z][a-zA-Z0-9]{0,40}$/, SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const MAX_BYTES = 256 * 1024, MAX_PER_APP = 16, MAX_COMPONENTS = 256;
const names = (pattern: RegExp) => z.array(z.string().regex(pattern)).max(16).refine(items => new Set(items).size === items.length, "Duplicate names").default([]);
const propsSchema = z.object({ type: z.literal("object"), properties: z.record(z.string(), z.record(z.string(), z.unknown())), required: z.array(z.string()).optional(), additionalProperties: z.literal(false) }).strict();
const definitionSchema = z.object({
  name: z.string().regex(NAME), javascript: z.string().min(1), css: z.string().optional(), props: propsSchema,
  events: names(/^[a-z][a-zA-Z0-9]*$/), slots: names(/^[a-z][a-zA-Z0-9]*$/), tools: names(SLUG),
}).strict();
const storedSchema = definitionSchema.extend({ module: z.string().regex(SLUG), moduleId: z.string().min(1), hash: z.string().min(1), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ExecutableComponent = z.infer<typeof storedSchema>;
export type ComponentExtension = Pick<ExecutableComponent, "revision" | "props" | "events" | "slots" | "tools">;
const fail = (message: string, code = "invalid") => Object.assign(new Error(message), { code });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const dynamic = (value: unknown) => record(value) && Object.keys(value).some(key => key.startsWith("$"));
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const componentKey = (component: Pick<ExecutableComponent, "module" | "name">) => `${component.module}:${component.name}`;

/** Caller identity comes only from the SDK event; an argument can never select another owner. */
export function componentOwner(caller: Caller | undefined, modules: ModuleState[]) {
  if (caller?.kind !== "module" || !caller.module || !caller.moduleId || !caller.hash) throw fail("只有身份和版本完整的应用可以登记可执行组件", "forbidden");
  const owner = modules.find(item => item.name === caller.module && item.id === caller.moduleId && item.status === "active" && item.activeHash === caller.hash);
  if (!owner) throw fail("应用身份或已批准的启用版本已变化", "conflict");
  return { module: owner.name, moduleId: owner.id, hash: caller.hash };
}
export function componentActive(component: ExecutableComponent, modules: ModuleState[]) {
  return modules.some(item => item.id === component.moduleId && item.name === component.module && item.status === "active" && item.activeHash === component.hash);
}
// Admit only constraints the converter enforces. In particular, refs can become recursive
// when properties are compiled independently, and unsupported keywords otherwise disappear.
const schemaKeywords: Record<string, string[]> = {
  string: ["minLength", "maxLength", "pattern"], number: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
  integer: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"], boolean: [], null: [],
  object: ["properties", "required", "additionalProperties"], array: ["items", "minItems", "maxItems"],
};
function checkedSchemaFields(value: Record<string, unknown>) {
  const { type, enum: _choices, const: _constant, ...rest } = value;
  const fields = typeof type === "string" && Object.hasOwn(schemaKeywords, type) ? schemaKeywords[type]! : [];
  if (type !== undefined && (typeof type !== "string" || !Object.hasOwn(schemaKeywords, type))) throw fail("不支持的属性 schema type");
  const allowed = new Set(["type", "title", "description", "default", "examples", "enum", "const", ...fields]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw fail("属性 schema 包含不支持的约束（不支持 $ref、组合或自定义关键字）");
  if (type === undefined && Object.keys(rest).some(key => !["title", "description", "default", "examples"].includes(key))) throw fail("属性 schema 约束需要 type");
  return fields;
}
function checkSchemaConstraints(value: Record<string, unknown>) {
  for (const key of ["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]) {
    if (value[key] === undefined) continue;
    const number = value[key];
    if (typeof number !== "number" || !Number.isFinite(number) || (["minLength", "maxLength", "minItems", "maxItems"].includes(key) && (!Number.isInteger(number) || number < 0)) || (key === "multipleOf" && number <= 0)) throw fail(`属性 schema.${key} 无效`);
  }
  if (value.pattern !== undefined && typeof value.pattern !== "string") throw fail("属性 schema.pattern 必须为字符串");
}
function checkedObjectProperties(value: Record<string, unknown>, depth: number) {
  const properties = value.properties ?? {}, required = value.required ?? [];
  if (!record(properties) || !Array.isArray(required) || required.some(key => typeof key !== "string" || !Object.hasOwn(properties, key)) || new Set(required).size !== required.length) throw fail("属性 schema.properties/required 无效");
  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== "boolean") throw fail("属性 schema.additionalProperties 必须为布尔值");
  return Object.fromEntries(Object.entries(properties).map(([key, child]) => [key, checkedSchema(child, depth + 1)]));
}
function checkSchemaChoices(value: Record<string, unknown>, fields: string[]) {
  const { type, enum: choices, const: constant } = value;
  if (choices === undefined && !Object.hasOwn(value, "const")) return;
  const values = choices === undefined ? [constant] : choices;
  if (!Array.isArray(values) || values.some(item => item !== null && !["string", "number", "boolean"].includes(typeof item)) || fields.some(key => value[key] !== undefined)) throw fail("enum/const 仅支持原始值，不支持组合约束");
  const primitive = z.fromJSONSchema({ type } as Parameters<typeof z.fromJSONSchema>[0]);
  if (values.some(item => !primitive.safeParse(item).success) || (choices !== undefined && Object.hasOwn(value, "const"))) throw fail("enum/const 必须符合 type 且不能同时声明");
}
function checkedSchema(value: unknown, depth = 0): Record<string, unknown> {
  if (!record(value) || depth > 16) throw fail("属性 schema 必须为对象且嵌套最多 16 层");
  const fields = checkedSchemaFields(value);
  const result: Record<string, unknown> = { ...value }; delete result.default;
  checkSchemaConstraints(value);
  if (value.type === "object") result.properties = checkedObjectProperties(value, depth);
  if (value.type === "array") result.items = checkedSchema(value.items ?? {}, depth + 1);
  checkSchemaChoices(value, fields);
  return result;
}
function validateDefinition(component: z.infer<typeof definitionSchema>) {
  if (Object.hasOwn(builtins, component.name)) throw fail("可执行组件不能与内置组件重名");
  if (Buffer.byteLength(JSON.stringify(component)) > MAX_BYTES) throw fail("每个可执行组件最多 256 KiB（包含代码和契约）");
  const required = component.props.required ?? [];
  if (new Set(required).size !== required.length || required.some(key => !Object.hasOwn(component.props.properties, key))) throw fail("props.required 必须引用已声明且不重复的属性");
  try {
    z.fromJSONSchema(checkedSchema(component.props));
    const scanned = new Bun.Transpiler({ loader: "js" }).scan(component.javascript);
    if (!scanned.exports.includes("default") || scanned.imports.length) throw new Error("需要自包含的 ESM default export mount(element, context)，不支持 imports");
  } catch (error) { throw fail(`可执行组件契约或 JavaScript 无效：${(error as Error).message}`); }
}
/** Dynamic render expressions are admitted at registration; literal props use the declared JSON schema. */
export function executablePropErrors(name: string, definition: ComponentExtension, props: Record<string, unknown>) {
  const errors: string[] = [], shape = definition.props.properties;
  for (const key of definition.props.required ?? []) if (props[key] === undefined) errors.push(`${name}: 缺少属性 ${key}`);
  for (const [key, value] of Object.entries(props)) {
    if (!Object.hasOwn(shape, key)) { errors.push(`${name}: 没有属性 ${key}`); continue; }
    if (!dynamic(value) && !z.fromJSONSchema(checkedSchema(shape[key]!)).safeParse(value).success) errors.push(`${name}.${key}: 不符合属性契约`);
  }
  return errors;
}
export function extension(component: ExecutableComponent): ComponentExtension {
  const { revision, props, events, slots, tools } = component;
  return { revision, props, events, slots, tools };
}

/** Web-private storage. Page operations allow concurrent reads and serialize writes. No source is ever evaluated here. */
export function createExecutableComponents(dataDir: string) {
  const file = join(dataDir, "executable-components.json");
  let cached: ExecutableComponent[] | undefined, loading: Promise<ExecutableComponent[]> | undefined;
  async function load() {
    if (cached) return cached;
    if (loading) return loading;
    loading = readStored();
    try { return await loading; } finally { loading = undefined; }
  }
  async function readStored() {
    try {
      if ((await stat(file)).size > MAX_BYTES * MAX_COMPONENTS + 256 * 1024) throw fail("可执行组件存储超过上限");
      const parsed = z.object({ components: storedSchema.array().max(MAX_COMPONENTS) }).strict().parse(JSON.parse(await readFile(file, "utf8")));
      const keys = new Set<string>(), counts = new Map<string, number>();
      for (const component of parsed.components) {
        const { revision, ...body } = component, key = componentKey(component);
        const { module: _module, moduleId: _moduleId, hash: _hash, ...definition } = body;
        validateDefinition(definition);
        if (Buffer.byteLength(JSON.stringify(component)) > MAX_BYTES) throw fail("可执行组件存储超过单个组件上限");
        if (fingerprint(body) !== revision || keys.has(key)) throw fail("可执行组件存储版本无效");
        keys.add(key); counts.set(component.moduleId, (counts.get(component.moduleId) ?? 0) + 1);
        if (counts.get(component.moduleId)! > MAX_PER_APP) throw fail("应用可执行组件存储超过上限");
      }
      cached = parsed.components;
    } catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; cached = []; }
    return cached;
  }
  async function save(next: ExecutableComponent[]) {
    await mkdir(dataDir, { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ components: next }), { mode: 0o600 });
    await rename(temporary, file);
    cached = next;
  }
  return {
    async set(args: Record<string, unknown>, caller: Caller | undefined, modules: ModuleState[]) {
      const owner = componentOwner(caller, modules), parsed = definitionSchema.safeParse(args);
      if (!parsed.success) throw fail("可执行组件需要 name、javascript、props 和可选 css、events、slots、tools");
      validateDefinition(parsed.data);
      const body = { ...parsed.data, ...owner }, component = { ...body, revision: fingerprint(body) };
      if (Buffer.byteLength(JSON.stringify(component)) > MAX_BYTES) throw fail("每个可执行组件最多 256 KiB（包含代码和契约）");
      // Drop removed owners on mutation, but retain disabled registrations for a same-version enable.
      const others = (await load()).filter(item => modules.some(owner => owner.id === item.moduleId && owner.name === item.module) && componentKey(item) !== componentKey(component));
      if (others.filter(item => item.moduleId === owner.moduleId).length >= MAX_PER_APP) throw fail("每个应用最多 16 个可执行组件");
      if (others.length >= MAX_COMPONENTS) throw fail("Web 最多 256 个可执行组件");
      await save([...others, component]);
      return { name: component.name, type: componentKey(component), revision: component.revision };
    },
    async remove(args: Record<string, unknown>, caller: Caller | undefined, modules: ModuleState[]) {
      const owner = componentOwner(caller, modules);
      const parsed = z.object({ name: z.string().regex(NAME) }).strict().safeParse(args);
      if (!parsed.success) throw fail("component-remove 需要组件名称 name");
      const all = await load(), next = all.filter(item => !(item.moduleId === owner.moduleId && item.module === owner.module && item.name === parsed.data.name));
      if (next.length !== all.length) await save(next);
      return { removed: next.length !== all.length };
    },
    async names(module: string, moduleId: string) {
      return new Set((await load()).filter(item => item.module === module && item.moduleId === moduleId).map(componentKey));
    },
    async available(module: string, moduleId: string, modules: ModuleState[]) {
      return new Map((await load()).filter(item => item.module === module && item.moduleId === moduleId && componentActive(item, modules)).map(item => [componentKey(item), item]));
    },
    async get(module: string, name: string, revision: string | null, modules: ModuleState[]) {
      const component = (await load()).find(item => item.module === module && item.name === name);
      if (!component) throw fail("没有这个可执行组件", "not_found");
      if (!revision || component.revision !== revision || !componentActive(component, modules)) throw fail("可执行组件版本已失效，请重新打开页面", "conflict");
      return component;
    },
  };
}

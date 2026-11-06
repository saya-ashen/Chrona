import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { BUILTIN_ACTIONS, CATALOG_VERSION, callParams, catalog, components as definitions } from "./catalog";

/**
 * Pages apps register with web (module-dependency-direction §4): an app sends a json-render spec plus references to its
 * own tools; web stores it under the kernel-recorded caller and later calls only those tools. Web knows no app by name.
 */
type Args = Record<string, unknown>;
type Schema = { properties?: Record<string, unknown>; required?: string[] };
export type Caller = { kind: string; module?: string; moduleId?: string };
export type ModuleState = { id: string; name: string; status: string; activeHash: string | null };
export type PageTool = { inputSchema: Schema; moduleId: string; contractHash: string };
/** `keyed`: the app's tools that take a request key (the page sends a fresh one per press); `needs`: each source's required arguments (not read while one is empty). */
export type Page = { module: string; moduleId: string; revision: string; contracts: Record<string, string>; id: string; title: string; data: Record<string, Source>; spec: Spec; keyed: string[]; needs: Record<string, string[]>; catalog: string; updatedAt: string };
type Source = { tool: string; args?: Args; refresh?: number };
type Spec = { root: string; elements: Record<string, Element>; state?: Args };
type Element = { type: string; props?: Args; children?: string[]; on?: Record<string, unknown>; [key: string]: unknown };
export type Deps = { dataDir: string; modules: () => Promise<ModuleState[]>; tools: (module: string) => Promise<Map<string, PageTool>>; now?: () => Date };

const SLUG = /^[a-z][a-z0-9-]{0,40}$/, MAX_BYTES = 64 * 1024, MAX_PAGES = 20, MAX_ELEMENTS = 300;
const invalid = (message: string) => Object.assign(new Error(message), { code: "invalid" });
const record = (value: unknown): value is Args => !!value && typeof value === "object" && !Array.isArray(value);
/** `{ $state: "/x" }` and the other json-render expressions are resolved at render time, so only literal values are checked. */
const dynamic = (value: unknown) => record(value) && Object.keys(value).some(key => key.startsWith("$"));

function checkArgs(where: string, tool: string, args: unknown, tools: Map<string, Schema>, errors: string[]) {
  const schema = tools.get(tool);
  if (!schema) { errors.push(`${where}: 应用没有工具 ${tool}`); return; }
  if (args === undefined) return;
  if (!record(args)) { errors.push(`${where}: args 必须是对象`); return; }
  const known = schema.properties ? Object.keys(schema.properties) : null;
  for (const key of Object.keys(args)) if (known && !known.includes(key)) errors.push(`${where}: 工具 ${tool} 没有参数 ${key}`);
}
function checkBinding(where: string, binding: unknown, tools: Map<string, Schema>, errors: string[]) {
  for (const item of Array.isArray(binding) ? binding : [binding]) {
    if (!record(item) || typeof item.action !== "string") { errors.push(`${where}: 动作格式无效`); continue; }
    if (item.action === "call") {
      const params = callParams.safeParse(item.params);
      if (!params.success) errors.push(`${where}: call 参数无效（${params.error.issues.map(issue => issue.path.join(".") || issue.message).join("、")}）`);
      else checkArgs(where, params.data.tool, params.data.args, tools, errors);
    } else if (!BUILTIN_ACTIONS.has(item.action)) errors.push(`${where}: 未知动作 ${item.action}`);
    for (const next of ["onSuccess", "onError"]) if (record(item[next]) && typeof item[next].action === "string") checkBinding(`${where}.${next}`, item[next], tools, errors);
  }
}
/** catalog.validate checks only the spec's structure, so components, props and actions are checked here. */
// eslint-disable-next-line complexity -- Keep app-supplied spec validation and its ordered diagnostics together.
export function pageErrors(input: { spec: unknown; data?: unknown }, tools: Map<string, Schema>, module: string) {
  const errors: string[] = [], structure = catalog.validate(input.spec);
  if (!structure.success) return [`spec 结构无效：${structure.error?.issues.slice(0, 5).map(issue => `${issue.path.join(".")} ${issue.message}`).join("；")}`];
  const elements = (input.spec as Spec).elements;
  if (Object.keys(elements).length > MAX_ELEMENTS) errors.push(`元素最多 ${MAX_ELEMENTS} 个`);
  for (const [key, element] of Object.entries(elements)) {
    const definition = (definitions as Partial<typeof definitions>)[element.type], where = `elements.${key}`;
    if (!definition) { errors.push(`${where}: 未知组件 ${element.type}`); continue; }
    for (const [name, value] of Object.entries(element.props ?? {})) {
      const prop = (definition.props.shape as Partial<typeof definition.props.shape>)[name];
      if (!prop) errors.push(`${where}.props.${name}: ${element.type} 没有这个属性`);
      else if (!dynamic(value) && !prop.safeParse(value).success) errors.push(`${where}.props.${name}: 值不符合 ${element.type} 的定义`);
    }
    if (element.type === "Image" && typeof element.props?.ref === "string" && !element.props.ref.startsWith(`${module}/`)) errors.push(`${where}.props.ref: 图片只能引用本应用 ${module}/ 的内容`);
    for (const [event, binding] of Object.entries(element.on ?? {})) {
      if (definition.events && !definition.events.includes(event)) errors.push(`${where}.on.${event}: ${element.type} 没有这个事件`);
      checkBinding(`${where}.on.${event}`, binding, tools, errors);
    }
  }
  if (input.data !== undefined) {
    if (!record(input.data)) errors.push("data 必须是对象");
    else for (const [key, source] of Object.entries(input.data)) {
      const where = `data.${key}`;
      if (!SLUG.test(key)) errors.push(`${where}: 名称须为小写字母开头的 slug`);
      if (!record(source) || typeof source.tool !== "string") { errors.push(`${where}: 需要 tool`); continue; }
      if (source.refresh !== undefined && (!Number.isInteger(source.refresh) || Number(source.refresh) < 5 || Number(source.refresh) > 3600)) errors.push(`${where}.refresh: 5–3600 秒的整数`);
      checkArgs(where, source.tool, source.args, tools, errors);
    }
  }
  return errors;
}

const moduleStateSchema = z.object({ id: z.string().min(1), name: z.string().min(1), status: z.string(), activeHash: z.string().nullable() });
function activeOwner(modules: ModuleState[], moduleId: string, name: string) {
  return modules.find(item => item.id === moduleId && item.name === name && item.status === "active" && item.activeHash);
}
function assertPageIdentity(page: Partial<Page>) {
  if (!page.moduleId || !page.contracts || !page.revision) throw stalePage();
}
function assertRegistration(args: Args) {
  if (typeof args.id !== "string" || !SLUG.test(args.id)) throw invalid("id 须为小写字母开头的 slug");
  if (typeof args.title !== "string" || !args.title.trim() || args.title.length > 80) throw invalid("title 须为 1–80 个字符");
  if (JSON.stringify({ spec: args.spec, data: args.data }).length > MAX_BYTES) throw invalid("页面最多 64 KiB");
  return { id: args.id, title: args.title };
}
const stalePage = () => Object.assign(new Error("页面登记已失效，请应用重新登记页面"), { code: "conflict" });

export function createPages(deps: Deps) {
  const file = join(deps.dataDir, "pages.json");
  let pages: Page[] | undefined;
  async function load() {
    if (pages) return pages;
    try { pages = (JSON.parse(await readFile(file, "utf8")) as { pages: Page[] }).pages; }
    catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; pages = []; }
    return pages;
  }
  async function save(next: Page[]) {
    await mkdir(deps.dataDir, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify({ pages: next }));
    await rename(`${file}.tmp`, file);
    pages = next;
  }
  async function knownPages() {
    // A failed/incomplete read must never become an empty inventory and erase registrations.
    const parsed = moduleStateSchema.array().safeParse(await deps.modules());
    if (!parsed.success) throw new Error("应用目录读取失败");
    const modules = parsed.data;
    const all = await load(), kept = all.filter(page => !page.moduleId || modules.some(module => module.id === page.moduleId && module.name === page.module));
    if (kept.length !== all.length) await save(kept);
    return { modules, pages: kept };
  }
  async function set(module: string, moduleId: string, args: Args) {
    const { spec, data } = args, { id, title } = assertRegistration(args);
    const { modules } = await knownPages();
    if (!activeOwner(modules, moduleId, module)) throw Object.assign(new Error("应用身份已失效或尚未启用，请启用后重新登记页面"), { code: "conflict" });
    const current = await deps.tools(module);
    if ([...current.values()].some(tool => tool.moduleId !== moduleId || !/^[a-f0-9]{64}$/.test(tool.contractHash))) throw Object.assign(new Error("应用工具身份不匹配，请重新登记页面"), { code: "conflict" });
    const tools = new Map([...current].map(([name, tool]) => [name, tool.inputSchema]));
    const errors = pageErrors({ spec, data }, tools, module);
    if (errors.length) throw invalid(`页面无效：${errors.slice(0, 10).join("；")}`);
    const all = await load(), others = all.filter(page => !(page.module === module && page.id === id));
    if (others.filter(page => page.module === module).length >= MAX_PAGES) throw invalid(`每个应用最多 ${MAX_PAGES} 个页面`);
    const keyed = [...tools].filter(([, schema]) => schema.properties && Object.hasOwn(schema.properties, "request-key")).map(([name]) => name);
    const sources = (data ?? {}) as Record<string, Source>;
    const needs = Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, tools.get(source.tool)?.required ?? []]));
    const contracts = Object.fromEntries(references(spec as Spec, sources).map(name => [name, current.get(name)!.contractHash]));
    const revision = crypto.randomUUID();
    const page: Page = { module, moduleId, revision, contracts, id, title: title.trim(), data: sources, spec: spec as Spec, keyed, needs, catalog: CATALOG_VERSION, updatedAt: (deps.now?.() ?? new Date()).toISOString() };
    await save([...others, page]);
    return { id, catalog: CATALOG_VERSION };
  }
  // Page reads may prune deleted owners; serialize them with registration/removal saves.
  let pending: Promise<unknown> = Promise.resolve();
  function exclusive<T>(work: () => Promise<T>) {
    const next = pending.then(work); pending = next.catch(() => {}); return next;
  }
  return {
    /** Tools other modules call. Pages belong to the caller Chrona recorded, never to a name in the arguments. */
    tool(name: string, args: Args, caller: Caller | undefined) { return exclusive(async () => {
      if (name === "catalog") return describeCatalog();
      const module = caller?.kind === "module" ? caller.module : undefined, moduleId = caller?.moduleId;
      if (!module || !moduleId) throw Object.assign(new Error("只有身份完整的应用可以登记页面"), { code: "forbidden" });
      if (name === "page-set") return set(module, moduleId, args);
      if (name === "page-remove") {
        const all = await load(), next = all.filter(page => !(page.moduleId === moduleId && page.id === args.id));
        if (next.length !== all.length) await save(next);
        return { removed: next.length !== all.length };
      }
      if (name === "pages") return { items: (await load()).filter(page => page.moduleId === moduleId).map(({ id, title, updatedAt }) => ({ id, title, updatedAt })) };
      throw new Error(`Unknown tool ${name}`);
    }); },
    /** For the page: what active apps registered. Pages of apps that are gone are dropped. */
    list() { return exclusive(async () => {
      const { modules, pages } = await knownPages();
      return pages.filter(page => modules.some(module => module.id === page.moduleId && module.status === "active" && module.activeHash)).map(({ module, id, title }) => ({ module, id, title }));
    }); },
    get(module: string, id: string) { return exclusive(async () => {
      const { modules, pages } = await knownPages(), page = pages.find(page => page.module === module && page.id === id);
      if (!page) return null;
      assertPageIdentity(page);
      const owner = modules.find(item => item.id === page.moduleId);
      if (!owner || owner.status !== "active" || !owner.activeHash) throw Object.assign(new Error("应用已暂停或不可用，请先恢复应用"), { code: "conflict" });
      const current = await deps.tools(module);
      for (const [name, contract] of Object.entries(page.contracts)) {
        const tool = current.get(name);
        if (!tool || tool.moduleId !== owner.id || tool.contractHash !== contract) throw stalePage();
      }
      const tools = new Map([...current].map(([name, tool]) => [name, tool.inputSchema]));
      if (pageErrors(page, tools, module).length) throw stalePage();
      return { ...page, keyed: [...tools].filter(([, schema]) => schema.properties && Object.hasOwn(schema.properties, "request-key")).map(([name]) => name),
        needs: Object.fromEntries(Object.entries(page.data).map(([key, source]) => [key, tools.get(source.tool)?.required ?? []])) };
    }); },
  };
}

function references(spec: Spec, sources: Record<string, Source>) {
  const names = new Set(Object.values(sources).map(source => source.tool));
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!record(value)) return;
    if (value.action === "call" && record(value.params) && typeof value.params.tool === "string") names.add(value.params.tool);
    Object.values(value).forEach(visit);
  };
  for (const element of Object.values(spec.elements)) visit(element.on);
  return [...names];
}

/** Under the 16 KiB tool result limit: component props as JSON Schema, events, and how data and `call` work. */
export function describeCatalog() {
  return {
    catalog: CATALOG_VERSION,
    components: Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, {
      props: Object.fromEntries(Object.entries(definition.props.shape).map(([prop, type]) => [prop, compact(z.toJSONSchema(type, { unrepresentable: "any" }))])),
      ...(definition.events?.length ? { events: definition.events } : {}),
      ...(definition.slots?.length ? { children: true } : {}),
    }])),
    rules: [
      "page-set {id, title, data?, spec}: spec is a json-render spec {root, elements:{key:{type, props, children:[keys], on?}}}.",
      "data: {name: {tool, args?, refresh?}} calls one of your own tools when the page opens (and every refresh seconds, 5-3600); the result is state /name. args may use {\"$state\": \"/path\"}; data is re-read when such a value changes.",
      "Props may use {\"$state\": \"/path\"}, {\"$bindState\": \"/path\"} for inputs, {\"$template\": \"${field}/\"}, and repeat/$item for lists. In a top-level action param $item is the item's state path; use {\"$template\": \"${field}\"} for its value (nested call args resolve $item to the value).",
      "on.<event>: {action: \"call\", params: {tool, args?, result?, reload?}, confirm?: {title, message}} calls your tool; a tool with a request-key parameter gets a fresh key unless args sets one. result stores the output at a state path; data is re-read unless reload is false. Built-in actions: setState, pushState, removeState.",
      "Ask with confirm ({title, message, confirmLabel, cancelLabel, variant: \"danger\"} in the user's language) for anything that changes data. Web shows loading, empty and error states; register again on every start (idempotent).",
    ],
  };
}
function compact(schema: unknown): unknown {
  if (!record(schema)) return schema;
  const { $schema: _, ...rest } = schema;
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, Array.isArray(value) ? value.map(compact) : compact(value)]));
}

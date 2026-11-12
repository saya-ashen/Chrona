import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { BUILTIN_ACTIONS, CATALOG_VERSION, callParams, catalog, components as definitions } from "./catalog";
import { expandComponents, type PageSpec } from "./composition";
import { componentOwner, createExecutableComponents, executablePropErrors, extension, type ComponentExtension, type ExecutableComponent } from "./executable-components";

/**
 * Pages apps register with web (module-dependency-direction §4): an app sends a json-render spec plus references to its
 * own tools; web stores it under the kernel-recorded caller and later calls only those tools. Web knows no app by name.
 */
type Args = Record<string, unknown>;
type Schema = { description?: string; properties?: Record<string, unknown>; required?: string[] };
export type Caller = { kind: string; module?: string; moduleId?: string; hash?: string };
export type ModuleState = { id: string; name: string; status: string; activeHash: string | null };
export type PageTool = { inputSchema: Schema; moduleId: string };
/** `keyed`: the app's tools that take a request key (the page sends a fresh one per press); `needs`: each source's required arguments (not read while one is empty). */
export type Page = { module: string; moduleId: string; hash?: string; extensions?: Record<string, ComponentExtension>; templates?: string[]; revision: string; id: string; title: string; purpose?: "settings"; data: Record<string, Source>; spec: Spec; keyed: string[]; needs: Record<string, string[]>; catalog: string; updatedAt: string; layout?: "document" | "workspace"; content?: { tool: string } };
type Source = { tool: string; args?: Args; refresh?: number };
type Spec = { root: string; elements: Record<string, Element>; state?: Args };
type Element = { type: string; props?: Args; children?: string[]; on?: Record<string, unknown>; [key: string]: unknown };
export type Deps = { dataDir: string; modules: () => Promise<ModuleState[]>; tools: (module: string) => Promise<Map<string, PageTool>>; toolInventory?: () => Promise<(PageTool & { target: string })[]>; now?: () => Date };

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
export function pageErrors(input: { spec: unknown; data?: unknown; components?: unknown; layout?: unknown; content?: unknown; purpose?: unknown }, tools: Map<string, Schema>, module: string, extensions: Map<string, ComponentExtension> = new Map()) {
  if (input.purpose !== undefined && input.purpose !== "settings") return ["purpose 须为 settings 或不填写"];
  if (input.layout !== undefined && input.layout !== "document" && input.layout !== "workspace") return ["layout 须为 document 或 workspace"];
  if (input.components !== undefined) {
    try { input = { ...input, spec: expandComponents(input.spec, input.components, module), components: undefined }; }
    catch (error) { return [(error as Error).message]; }
  }
  if (Buffer.byteLength(JSON.stringify({ spec: input.spec, data: input.data })) > MAX_BYTES) return ["展开后的页面最多 64 KiB"];
  // The catalog's type enum otherwise prints every built-in for an unknown app component.
  if (record(input.spec) && record(input.spec.elements)) {
    const unknown = Object.entries(input.spec.elements).flatMap(([key, element]) => {
      if (!record(element) || typeof element.type !== "string" || !element.type.includes(":") || Object.hasOwn(definitions, element.type) || extensions.has(element.type)) return [];
      return [`elements.${key.slice(0, 80)}: 未知自定义组件 ${element.type.slice(0, 80)}；请先调用 web.component-set 并原样使用返回的 type（当前应用前缀 ${module}:），或在 components 中声明本应用模板`];
    });
    if (unknown.length) return unknown.slice(0, 5);
  }
  const extended = extensions.size ? defineCatalog(schema, {
    components: { ...definitions, ...Object.fromEntries([...extensions].map(([name, component]) => [name, { props: z.object({}).catchall(z.unknown()), events: component.events, slots: component.slots, description: "Trusted app executable component" }])) },
    actions: { call: { params: callParams, description: "Call a pinned app tool" } },
  }) : catalog;
  const errors: string[] = [], structure = extended.validate(input.spec);
  if (input.content !== undefined) {
    if (!record(input.content) || Object.keys(input.content).some(key => key !== "tool") || typeof input.content.tool !== "string" || !SLUG.test(input.content.tool)) errors.push("content 须为 {tool: 本应用工具名}");
    else {
      checkArgs("content", input.content.tool, { ref: `${module}/image.png` }, tools, errors);
      const schema = tools.get(input.content.tool);
      if (schema && (!schema.properties?.ref || schema.required?.some(key => key !== "ref"))) errors.push("content 工具须接受 {ref}，不得要求其他参数");
    }
  }
  if (!structure.success) return [`spec 结构无效：${structure.error?.issues.slice(0, 5).map(issue => `${issue.path.join(".")} ${issue.message}`).join("；")}`];
  const elements = (input.spec as Spec).elements;
  if (Object.keys(elements).length > MAX_ELEMENTS) errors.push(`元素最多 ${MAX_ELEMENTS} 个`);
  for (const [key, element] of Object.entries(elements)) {
    const builtin = Object.hasOwn(definitions, element.type) ? (definitions as Partial<typeof definitions>)[element.type] : undefined;
    const custom = extensions.get(element.type), definition = builtin ?? custom, where = `elements.${key}`;
    if (!definition) { errors.push(`${where}: 未知组件 ${element.type}`); continue; }
    if (custom) {
      errors.push(...executablePropErrors(where, custom, element.props ?? {}));
      if (element.children?.length && !custom.slots.includes("default")) errors.push(`${where}: ${element.type} 没有 default 插槽`);
      for (const tool of custom.tools) checkArgs(where, tool, undefined, tools, errors);
    } else if (builtin) for (const [name, value] of Object.entries(element.props ?? {})) {
      const prop = (builtin.props.shape as Partial<typeof builtin.props.shape>)[name];
      if (!prop) errors.push(`${where}.props.${name}: ${element.type} 没有这个属性`);
      else if (!dynamic(value) && !prop.safeParse(value).success) errors.push(`${where}.props.${name}: 值不符合 ${element.type} 的定义`);
    }
    if (element.type === "Image" && typeof element.props?.ref === "string" && !element.props.ref.startsWith(`${module}/`)) errors.push(`${where}.props.ref: 图片只能引用本应用 ${module}/ 的内容`);
    if (record(element.slots)) for (const [slot, keys] of Object.entries(element.slots)) {
      if (!definition.slots?.includes(slot)) errors.push(`${where}.slots.${slot}: ${element.type} 没有这个插槽`);
      if (!Array.isArray(keys) || keys.some(child => typeof child !== "string" || !Object.hasOwn(elements, child))) errors.push(`${where}.slots.${slot}: 需要存在的子组件键`);
    }
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
  if (!page.moduleId || !page.revision) throw stalePage();
}
function assertRegistration(args: Args) {
  if (typeof args.id !== "string" || !SLUG.test(args.id)) throw invalid("id 须为小写字母开头的 slug");
  if (typeof args.title !== "string" || !args.title.trim() || args.title.length > 80) throw invalid("title 须为 1–80 个字符");
  if (Buffer.byteLength(JSON.stringify({ spec: args.spec, data: args.data, components: args.components })) > MAX_BYTES) throw invalid("页面最多 64 KiB");
  return { id: args.id, title: args.title };
}
const stalePage = () => Object.assign(new Error("页面登记已失效，请应用重新登记页面"), { code: "conflict" });

type PageOwner = { module: string; moduleId: string; caller: Caller };
function pageOwner(caller: Caller | undefined): PageOwner {
  const module = caller?.kind === "module" ? caller.module : undefined, moduleId = caller?.moduleId;
  if (!module || !moduleId) throw Object.assign(new Error("只有身份完整的应用可以登记页面"), { code: "forbidden" });
  return { module, moduleId, caller: caller! };
}
type PageStore = {
  load: () => Promise<Page[]>;
  save: (pages: Page[]) => Promise<void>;
  knownPages: () => Promise<{ modules: ModuleState[]; pages: Page[] }>;
};
async function pageComposition(components: ReturnType<typeof createExecutableComponents>, owner: PageOwner, args: Args, modules: ModuleState[]) {
  const { module, moduleId, caller } = owner;
  const available = await components.available(module, moduleId, modules);
  const templates = record(args.components) ? Object.keys(args.components) : [];
  const registered = await components.names(module, moduleId);
  if (templates.some(name => registered.has(name))) throw invalid("声明式组件不能与已登记的可执行组件重名");
  const spec: PageSpec = expandComponents(args.spec, args.components, module);
  const used = new Set(Object.values(spec.elements).map(element => element.type));
  const extensions = new Map([...available].filter(([name]) => used.has(name)).map(([name, component]) => [name, extension(component)]));
  // Preserve the registering version even for ordinary declarative pages. Legacy
  // callers without a version can register those pages, but cannot prove delivery.
  const hash = extensions.size || caller.hash !== undefined ? componentOwner(caller, modules).hash : undefined;
  return { spec, templates, extensions, hash };
}
function assertPageCapacity(others: Page[], module: string, moduleId: string, purpose: unknown) {
  if (others.filter(page => page.module === module).length >= MAX_PAGES) throw invalid(`每个应用最多 ${MAX_PAGES} 个页面`);
  if (purpose === "settings" && others.some(page => page.moduleId === moduleId && page.purpose === "settings")) throw Object.assign(new Error("每个应用只能登记一个设置页面，请更新原页面或先移除原登记"), { code: "conflict" });
}
async function registerPage(deps: Deps, store: PageStore, components: ReturnType<typeof createExecutableComponents>, owner: PageOwner, args: Args) {
  const { module, moduleId } = owner;
  const { knownPages, load, save } = store;
  const { data, content, purpose } = args, { id, title } = assertRegistration(args);
  const { modules } = await knownPages();
  if (!activeOwner(modules, moduleId, module)) throw Object.assign(new Error("应用身份已失效或尚未启用，请启用后重新登记页面"), { code: "conflict" });
  const { spec, templates, extensions, hash } = await pageComposition(components, owner, args, modules);
  const layout = args.layout === undefined ? "document" : args.layout;
  const current = await deps.tools(module);
  if ([...current.values()].some(tool => tool.moduleId !== moduleId)) throw Object.assign(new Error("应用工具身份不匹配，请重新登记页面"), { code: "conflict" });
  // Discovery includes only tools Web may actually call, with the real caller's visibility.
  const tools = new Map([...current].map(([name, tool]) => [name, tool.inputSchema]));
  const errors = pageErrors({ spec, data, layout, content, purpose }, tools, module, extensions);
  if (errors.length) throw invalid(`页面无效：${errors.slice(0, 10).join("；")}`);
  const all = await load(), others = all.filter(page => !(page.module === module && page.id === id));
  assertPageCapacity(others, module, moduleId, purpose);
  const keyed = [...tools].filter(([, schema]) => schema.properties && Object.hasOwn(schema.properties, "request-key")).map(([name]) => name);
  const sources = (data ?? {}) as Record<string, Source>;
  const needs = Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, tools.get(source.tool)?.required ?? []]));
  const provider = content as Page["content"];
  const revision = crypto.randomUUID();
  const page: Page = { module, moduleId, ...(hash ? { hash } : {}), ...(extensions.size ? { extensions: Object.fromEntries(extensions) } : {}), ...(templates.length ? { templates } : {}), revision, id, title: title.trim(), ...(purpose === "settings" ? { purpose } : {}), data: sources, content: provider, spec: spec as Spec, layout: layout as Page["layout"], keyed, needs, catalog: CATALOG_VERSION, updatedAt: (deps.now?.() ?? new Date()).toISOString() };
  await save([...others, page]);
  return { id, catalog: CATALOG_VERSION };
}

function pinnedPageExtensions(page: Page, owner: ModuleState, available: Map<string, ExecutableComponent>) {
  const extensions = new Map<string, ComponentExtension>();
  if (page.extensions) {
    if (page.hash !== owner.activeHash || owner.name !== page.module) throw stalePage();
    for (const [name, pinned] of Object.entries(page.extensions)) {
      const component = available.get(name);
      if (!component || JSON.stringify(extension(component)) !== JSON.stringify(pinned)) throw stalePage();
      extensions.set(name, extension(component));
    }
  }
  return extensions;
}

function pageAccess() {
  // Writers wait for earlier reads; later reads wait for the writer.
  let pending: Promise<unknown> = Promise.resolve(), readers: Promise<void> = Promise.resolve();
  return {
    read<T>(work: () => Promise<T>) {
      const next = pending.then(work);
      readers = Promise.allSettled([readers, next]).then(() => {});
      return next;
    },
    exclusive<T>(work: () => Promise<T>) {
      const next = Promise.all([pending, readers]).then(work);
      pending = next.catch(() => {}); readers = Promise.resolve(); return next;
    },
  };
}

/** Caller-visible discovery lives for exactly one navigation inventory operation. */
function listTools(deps: Deps): Deps["tools"] {
  const tools = new Map<string, ReturnType<Deps["tools"]>>();
  let inventory: Promise<Map<string, Map<string, PageTool>>> | undefined;
  const filtered = (module: string) => {
    if (!tools.has(module)) tools.set(module, deps.tools(module));
    return tools.get(module)!;
  };
  return module => {
    if (deps.toolInventory) {
      // Start only when an active page needs discovery, and group the complete
      // caller-visible inventory once for all pages in this list operation.
      inventory ??= deps.toolInventory().then(items => {
        const grouped = new Map<string, Map<string, PageTool>>();
        for (const tool of items) {
          const boundary = tool.target.indexOf("."), owner = tool.target.slice(0, boundary);
          if (!grouped.has(owner)) grouped.set(owner, new Map());
          grouped.get(owner)!.set(tool.target.slice(boundary + 1), tool);
        }
        return grouped;
      });
      // An unrelated oversized discovery item must not hide registered pages.
      // Retry the original caller-scoped path; it still checks referenced tool identities.
      return inventory.then(grouped => grouped.get(module) ?? new Map(), () => filtered(module));
    }
    return filtered(module);
  };
}

export function createPages(deps: Deps) {
  const file = join(deps.dataDir, "pages.json"), components = createExecutableComponents(deps.dataDir);
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
  let registry: Promise<unknown> = Promise.resolve();
  async function knownPages() {
    // A failed/incomplete read must never become an empty inventory and erase registrations.
    const parsed = moduleStateSchema.array().safeParse(await deps.modules());
    if (!parsed.success) throw new Error("应用目录读取失败");
    const modules = parsed.data;
    // Reads can overlap, but pruning must load and save against the latest registry.
    const next = registry.then(async () => {
      const all = await load(), kept = all.filter(page => !page.moduleId || modules.some(module => module.id === page.moduleId && module.name === page.module));
      if (kept.length !== all.length) await save(kept);
      return { modules, pages: kept };
    });
    registry = next.catch(() => {});
    return next;
  }
  async function validatedTools(page: Page, modules: ModuleState[], readTools = deps.tools) {
    assertPageIdentity(page);
    const owner = modules.find(item => item.id === page.moduleId);
    if (!owner || owner.status !== "active" || !owner.activeHash) throw Object.assign(new Error("应用已暂停或不可用，请先恢复应用"), { code: "conflict" });
    const current = await readTools(page.module);
    for (const name of pageToolNames(page)) {
      const tool = current.get(name);
      if (!tool || tool.moduleId !== owner.id) throw stalePage();
    }
    const tools = new Map([...current].map(([name, tool]) => [name, tool.inputSchema]));
    const available = await components.available(page.module, page.moduleId, modules);
    const extensions = pinnedPageExtensions(page, owner, available);
    if (pageErrors(page, tools, page.module, extensions).length) throw stalePage();
    return tools;
  }
  async function mutateComponent(name: string, args: Args, owner: PageOwner) {
    const { module, moduleId, caller } = owner;
    const { modules, pages } = await knownPages();
    componentOwner(caller, modules);
    if (name === "component-remove") return components.remove(args, caller, modules);
    if (pages.some(page => page.moduleId === moduleId && page.templates?.includes(`${module}:${String(args.name)}`))) throw invalid("可执行组件不能与已登记的声明式组件重名");
    return components.set(args, caller, modules);
  }
  const { read, exclusive } = pageAccess();
  return {
    /** Tools other modules call. Pages belong to the caller Chrona recorded, never to a name in the arguments. */
    tool(name: string, args: Args, caller: Caller | undefined) { return exclusive(async () => {
      if (name === "catalog") return describeCatalog();
      const owner = pageOwner(caller), { moduleId } = owner;
      if (name === "component-set" || name === "component-remove") return mutateComponent(name, args, owner);
      if (name === "page-set") return registerPage(deps, { knownPages, load, save }, components, owner, args);
      if (name === "page-remove") {
        const all = await load(), next = all.filter(page => !(page.moduleId === moduleId && page.id === args.id));
        if (next.length !== all.length) await save(next);
        return { removed: next.length !== all.length };
      }
      if (name === "pages") return { items: (await load()).filter(page => page.moduleId === moduleId).map(({ id, title, updatedAt, purpose }) => ({ id, title, updatedAt, ...(purpose ? { purpose } : {}) })) };
      throw new Error(`Unknown tool ${name}`);
    }); },
    /** Navigation includes only usable pages. Pages of apps that are gone are dropped. */
    list() { return read(async () => {
      const { modules, pages } = await knownPages();
      const readTools = listTools(deps);
      const results = await Promise.allSettled(pages.map(async page => {
        try { await validatedTools(page, modules, readTools); }
        catch (error) { if ((error as { code?: string }).code === "conflict") return null; throw error; }
        return page;
      }));
      // Drain validations even after an unexpected failure before allowing a writer.
      const available = results.flatMap(result => {
        if (result.status === "rejected") throw result.reason;
        return result.value ? [result.value] : [];
      });
      return available.map(({ module, moduleId, id, title, purpose }) => ({ module, moduleId, id, title, ...(purpose ? { purpose } : {}) }));
    }); },
    component(module: string, name: string, revision: string | null) { return read(async () => {
      const { modules } = await knownPages();
      return components.get(module, name, revision, modules);
    }); },
    get(module: string, id: string) { return read(async () => {
      const { modules, pages } = await knownPages(), page = pages.find(page => page.module === module && page.id === id);
      if (!page) return null;
      const tools = await validatedTools(page, modules);
      return { ...page, keyed: [...tools].filter(([, schema]) => schema.properties && Object.hasOwn(schema.properties, "request-key")).map(([name]) => name),
        needs: Object.fromEntries(Object.entries(page.data).map(([key, source]) => [key, tools.get(source.tool)?.required ?? []])) };
    }); },
  };
}

/** Only tool names referenced by the registered page may be called through its route. */
export function pageToolNames(page: Page) {
  return [...new Set([
    ...references(page.spec, page.data),
    ...Object.values(page.extensions ?? {}).flatMap(component => component.tools),
    ...(page.content ? [page.content.tool] : []),
  ])];
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

/** Component props as JSON Schema, events, and how data and `call` work. */
export function describeCatalog() {
  return {
    catalog: CATALOG_VERSION,
    components: Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, {
      props: Object.fromEntries(Object.entries(definition.props.shape).map(([prop, type]) => [prop, compact(z.toJSONSchema(type, { unrepresentable: "any" }))])),
      ...(definition.events?.length ? { events: definition.events } : {}),
      ...(definition.slots?.length ? { children: true, slots: definition.slots } : {}),
    }])),
    rules: [
      "UI guide: complete activated JS/CSS example and verification procedure ship in Web version material UI-DEVELOPMENT.md (obtain the exact approved source through Author). Prefer shared declarative catalog components/templates; use executable components for browser APIs such as files/audio. Composer uses on.submit; WorkspaceHeader.statusTone is app-supplied.",
      "Theme/CSS: same document, no iframe/Shadow DOM/style isolation. Inherit --fg text, --bg page, --card panel, --muted secondary text, --line border, --accent emphasis; --foreground/--background do not exist. Shell also owns --rail, --selection and --workspace-tint/--workspace-add/--workspace-remove. prefers-color-scheme:dark changes inherited values. Pair foreground/background; do not assume white on accent works in dark mode. Scope every selector under an app-specific root class; never change body/:root or global tags. Host header is sticky/flex/padded; section has border/padding/margin. Prefer scoped divs or explicitly override these properties under your root. Scope keyframes too; clean listeners, observers, media and own object URLs on destroy.",
      "Layout: document centers max-width 64rem with desktop 36px 32px padding (mobile 24px 16px); workspace removes main width/padding but retains shell navigation. Shared Workspace computes remaining visual viewport height from its top (minimum 240px) and tracks resize. layout alone does not size arbitrary executable roots. Prefer Workspace; never hardcode 900px or assume 100vh excludes navigation. Use min-width/min-height:0 and a deliberate overflow:auto region.",
      "Verification: registration-test.ts/build.ts --registration-test-only builds a portable helper in a Chrona checkout; it validates real activated registrations with a mocked SDK, not kernel activation or browser rendering. Isolated component tests do not prove host CSS compatibility. After approved activation, verify actual host page moduleId/hash/revision and test light/dark at 1440x900,1024x768,390x844; inspect contrast, global header/section collisions, navigation, scroll/focus/cleanup and no mobile horizontal overflow. Record browser evidence separately; Web tools do not automate a browser. Full example and state checklist: UI-DEVELOPMENT.md.",
      "page-set {id, title, purpose?: settings, layout?: document|workspace, components?, data?, content?: {tool}, spec}: spec is a json-render spec {root, elements:{key:{type, props, children:[keys], slots?:{name:[keys]}, on?}}}. Workspace accepts slots.sidebar alongside default children.",
      "purpose: settings marks the app-owned settings page. At most one per app; updating the same id replaces it. Omit purpose for ordinary pages. Settings navigation uses this metadata, never a tool or page id convention.",
      "components: {app:Name:{props:{type:object,properties:{name:JSONSchema},required?:[names],additionalProperties:false},events?:[names],slots?:[names],spec:{root,elements}}}. Use {$prop:name} for a passed prop, {$event:name} for a caller event binding, and child key $slot:name for supplied children. Here app is a placeholder for your actual module name (e.g. music:Card); definitions belong to this page revision, expand before tool checks, and cannot contain scripts or private state. Max 16 definitions, 8 nesting levels, 300 expanded nodes.",
      "component-set {name: AudioPlayer, javascript, css?, props: {type: object, properties, required?, additionalProperties: false}, events?, slots?, tools?} registers trusted self-contained browser ESM default export mount(element, {props, emit(event), call(tool,args), children?}) returning cleanup or {update?,destroy?}. Returns {name, type, revision}; use the returned type verbatim in spec.elements (e.g. music:AudioPlayer for an app named music). The app prefix is the caller's actual module name, never the literal placeholder app. Default children require slot default. Only the real active approved app version can register. Prop schemas support primitive types, scalar enum/const, typed string/number constraints, nested objects/arrays (max 16 levels); unsupported keywords including refs, schema combinators, format and contains are rejected. Max 256 KiB and 16/app. component-remove {name} invalidates dependent pages. Re-register pages after component changes. Declared tools are own app tool names, must be visible to Web, and are pinned by the page; call uses the existing page-bound call route. Executable code runs trusted in the authenticated browser origin, without isolation. GET /api/web/components/:app/:name?revision=... serves JSON source under existing API authentication. Page extensions provide revision, props, events, slots, tools.",
      "content: {tool} explicitly declares your own readable tool for Image. Web calls it with {ref}, restricted to your app/ prefix, bound to the registered module identity and validated against the current tool schema. Return null or {base64, mime}; only bounded PNG/JPEG/GIF/WebP raster images (max 8 MiB) are accepted. Without content, images cannot be read. Tool visibility must admit Web; no global content reader.",
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

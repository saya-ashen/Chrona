import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export type Caller = { kind: string; module?: string; moduleId?: string; hash?: string };
export type ModuleState = { id: string; name: string; status: string; activeHash: string | null };
type Schema = { properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown };
export type PageTool = { inputSchema: Schema; moduleId: string };
export type Deps = { dataDir: string; modules: () => Promise<ModuleState[]>; tools: (module: string) => Promise<Map<string, PageTool>>; toolInventory?: () => Promise<(PageTool & { target: string })[]>; now?: () => Date };
const slug = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/);
export const pageDefinition = z.object({
  id: slug, title: z.string().trim().min(1).max(80), purpose: z.literal("settings").optional(),
  layout: z.enum(["document", "workspace"]).default("document"),
  javascript: z.string().min(1), css: z.string().optional(),
  props: z.record(z.string(), z.unknown()).default({}),
  tools: z.array(slug).refine(items => new Set(items).size === items.length, "Duplicate tools").default([]),
  content: z.object({ tool: slug }).strict().optional(),
}).strict();
const storedPage = pageDefinition.extend({ module: slug, moduleId: z.string().min(1), hash: z.string().min(1), revision: z.string().min(1), contracts: z.record(z.string(), z.string()), keyed: z.array(z.string()), updatedAt: z.string() }).strict();
export type Page = z.infer<typeof storedPage>;
type Definition = z.infer<typeof pageDefinition>;
type Args = Record<string, unknown>;
const fail = (message: string, code = "invalid") => Object.assign(new Error(message), { code });
const stale = () => fail("页面或工具已变化，请重新打开页面", "conflict");
function contractShape(value: unknown, schema = true, properties = false): unknown {
  if (Array.isArray(value)) return value.map(item => contractShape(item, schema));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !schema || !["description", "title", "examples", "$schema"].includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, contractShape(child,
      properties || schema && ["items", "prefixItems", "allOf", "anyOf", "oneOf", "not", "if", "then", "else", "contains", "additionalProperties", "unevaluatedProperties", "propertyNames"].includes(key),
      schema && ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"].includes(key))]));
}
const fingerprint = (schema: Schema) => createHash("sha256").update(JSON.stringify(contractShape(schema))).digest("hex");

/** Validate executable source without evaluating app code in the server. */
export function pageErrors(input: unknown): string[] {
  const parsed = pageDefinition.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`);
  if (Buffer.byteLength(JSON.stringify(parsed.data)) > 1024 * 1024) return ["页面源码和样式最多 1 MiB"];
  try {
    const source = new Bun.Transpiler({ loader: "js" }).scan(parsed.data.javascript);
    if (!source.exports.includes("default") || source.imports.some(item => item.path !== "/pages.js")) return ["页面需要 ESM default export mount(element, host)，只能从 /pages.js 导入共享运行时"];
  } catch (error) { return [`页面 JavaScript 无效：${String(error)}`]; }
  return [];
}
export function pageToolNames(page: Pick<Page, "tools" | "content">) {
  return [...new Set([...page.tools, ...(page.content ? [page.content.tool] : [])])];
}
function owner(caller: Caller | undefined, modules: ModuleState[]) {
  if (caller?.kind !== "module" || !caller.module || !caller.moduleId || !caller.hash) throw fail("只有身份和版本完整的应用可以登记页面", "forbidden");
  if (!modules.some(item => item.id === caller.moduleId && item.name === caller.module && item.status === "active" && item.activeHash === caller.hash)) throw stale();
  return { module: caller.module, moduleId: caller.moduleId, hash: caller.hash };
}
function toolContracts(page: Pick<Page, "moduleId" | "tools" | "content">, tools: Map<string, PageTool>) {
  return Object.fromEntries(pageToolNames(page).map(name => {
    const tool = tools.get(name);
    if (!tool || tool.moduleId !== page.moduleId) throw fail(`应用没有可供 Web 调用的工具 ${name}`, "conflict");
    const ref = tool.inputSchema.properties?.ref;
    if (page.content?.tool === name && (!ref || typeof ref !== "object" || !("type" in ref) || ref.type !== "string" || tool.inputSchema.required?.some(key => key !== "ref"))) throw fail(`内容工具 ${name} 必须接受 {ref}，不能要求其他参数`, "conflict");
    return [name, fingerprint(tool.inputSchema)];
  }));
}
/** One inventory per navigation, including when multiple pages belong to the same app. */
function listTools(deps: Deps): Deps["tools"] {
  const cache = new Map<string, ReturnType<Deps["tools"]>>();
  let inventory: Promise<(PageTool & { target: string })[]> | undefined;
  return module => {
    if (!cache.has(module)) cache.set(module, deps.toolInventory
      ? (inventory ??= deps.toolInventory()).then(items => new Map(items.filter(item => item.target.startsWith(`${module}.`)).map(item => [item.target.slice(module.length + 1), item])), error => {
        console.error(JSON.stringify({ component: "web", event: "page_inventory_failed", error: String(error) }));
        return deps.tools(module);
      }) : deps.tools(module));
    return cache.get(module)!;
  };
}
export function createPages(deps: Deps) {
  // Page registrations are rebuilt by apps; keep the previous format untouched for rollback.
  const file = join(deps.dataDir, "pages-v2.json");
  let cached: Page[] | undefined, pending: Promise<unknown> = Promise.resolve(), readers: Promise<unknown> = Promise.resolve();
  async function load() {
    if (cached) return cached;
    try { cached = z.object({ pages: storedPage.array() }).strict().parse(JSON.parse(await readFile(file, "utf8"))).pages; }
    catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; cached = []; }
    return cached;
  }
  async function save(pages: Page[]) {
    await mkdir(deps.dataDir, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify({ pages }), { mode: 0o600 });
    await rename(`${file}.tmp`, file); cached = pages;
  }
  function read<T>(work: () => Promise<T>) {
    const result = pending.then(work);
    readers = Promise.allSettled([readers, result]).then(() => undefined); return result;
  }
  function exclusive<T>(work: () => Promise<T>) {
    const result = Promise.allSettled([pending, readers]).then(work);
    pending = result.then(() => undefined, error => { console.error(JSON.stringify({ component: "web", event: "page_mutation_failed", error: String(error) })); });
    readers = Promise.resolve(); return result;
  }
  async function modules() {
    return z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), activeHash: z.string().nullable() })).parse(await deps.modules());
  }
  async function validate(page: Page, states: ModuleState[], tools = deps.tools) {
    if (!states.some(item => item.id === page.moduleId && item.name === page.module && item.status === "active" && item.activeHash === page.hash)) throw stale();
    const current = await tools(page.module);
    if (JSON.stringify(toolContracts(page, current)) !== JSON.stringify(page.contracts)) throw stale();
    return current;
  }
  async function register(args: Args, caller: Caller | undefined) {
    const identity = owner(caller, await modules()), errors = pageErrors(args);
    if (errors.length) throw fail(errors.join("；"));
    const definition: Definition = pageDefinition.parse(args), current = await deps.tools(identity.module);
    const contracts = toolContracts({ ...definition, ...identity }, current);
    const all = await load(), others = all.filter(page => !(page.moduleId === identity.moduleId && page.hash === identity.hash && page.id === definition.id));
    const sameVersion = others.filter(page => page.moduleId === identity.moduleId && page.hash === identity.hash);
    if (sameVersion.length >= 20) throw fail("每个应用版本最多 20 个页面");
    if (definition.purpose === "settings" && sameVersion.some(page => page.purpose === "settings")) throw fail("每个应用只能登记一个设置页面", "conflict");
    const page: Page = { ...definition, ...identity, contracts, keyed: pageToolNames(definition).filter(name => Object.hasOwn(current.get(name)!.inputSchema.properties ?? {}, "request-key")), revision: crypto.randomUUID(), updatedAt: (deps.now?.() ?? new Date()).toISOString() };
    await save([...others, page]);
    return { id: page.id, revision: page.revision };
  }
  return {
    tool(name: string, args: Args, caller: Caller | undefined) { return exclusive(async () => {
      if (name === "catalog") return describeCatalog();
      if (name === "page-set") return register(args, caller);
      const identity = owner(caller, await modules());
      const own = (page: Page) => page.moduleId === identity.moduleId && page.hash === identity.hash;
      if (name === "page-remove") {
        const all = await load(), next = all.filter(page => !(own(page) && page.id === args.id));
        if (next.length !== all.length) await save(next);
        return { removed: next.length !== all.length };
      }
      if (name === "pages") return { items: (await load()).filter(own).map(({ id, title, purpose, updatedAt }) => ({ id, title, purpose, updatedAt })) };
      throw fail(`Unknown tool ${name}`, "not_found");
    }); },
    list() { return read(async () => {
      const states = await modules(), tools = listTools(deps);
      const results = await Promise.allSettled((await load()).map(async page => {
        try { await validate(page, states, tools); }
        catch (error) { if ((error as { code?: string }).code === "conflict") return null; throw error; }
        const { module, moduleId, id, title, purpose } = page;
        return { module, moduleId, id, title, ...(purpose ? { purpose } : {}) };
      }));
      return results.flatMap(result => { if (result.status === "rejected") throw result.reason; return result.value ? [result.value] : []; });
    }); },
    get(module: string, id: string) { return read(async () => {
      const states = await modules();
      const active = states.find(item => item.name === module && item.status === "active");
      const page = (await load()).find(page => page.module === module && page.moduleId === active?.id && page.hash === active.activeHash && page.id === id);
      if (!page) {
        if ((await load()).some(page => page.module === module && page.moduleId === states.find(item => item.name === module)?.id && page.id === id)) throw stale();
        return null;
      }
      await validate(page, states); return page;
    }); },
  };
}
export function describeCatalog() {
  return { runtime: "react", components: ["Button", "Card", "Input", "Select", "Table", "Dialog", "Tabs", "Markdown", "Workspace", "ScrollArea"], rules: [
    "Register page-set {id,title,layout?:document|workspace,purpose?:settings,javascript,css?,props?,tools?,content?:{tool}} on activation. Default export mount(element,host) returns cleanup or {destroy}. Only the active approved caller can register; identity, hash, revision and tool contracts stay pinned. Rollback selects registrations for that version.",
    "Import React, createRoot and ui from /pages.js; compile ESM with that import external. All pages share Web's React runtime and design tokens. Applications may also use self-contained imperative mount functions.",
    "host.call(tool,args) calls only declared own tools, handles error results and supplies request-key when declared by the tool. Keep local state and loading in React; calls never reload the whole page. host.navigate(path), host.confirm({title,message}), host.toast(message), host.contentUrl(ref) are available; revoke returned content URLs on cleanup.",
    "Trusted same-origin pages have no browser isolation. Scope CSS under your own root; inherit --fg/--bg/--card/--muted/--line/--accent. Web owns shell/navigation/theme. Clean listeners, timers and object URLs on destroy. See UI-DEVELOPMENT.md.",
    "Settings pages use purpose:settings; one per application version. Browser calls use authenticated /api/web with a fixed page revision. The content tool accepts {ref} within the owning app and returns bounded raster data.",
  ] };
}

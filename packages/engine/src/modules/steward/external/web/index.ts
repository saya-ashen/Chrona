import { applicationCall } from "./kernel-client";
import { chrona, on } from "chrona";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createPages, pageToolNames, type Caller, type ModuleState, type PageTool } from "./pages";
import { todayView } from "./today";
import { createAgentConversations, isAgentConversation } from "./agent-conversations";
import { readDeliveryPages } from "./delivery";
import { memoryView, memoryForget } from "./memory";
import { settingsView, updateSettings, webSettings, webPreferences, WEB_SETTINGS_PAGE } from "./settings";
import { createPreferences } from "./settings-store";
import { appOverview, systemApps } from "./app-overview";
import { attachmentBody, createAttachments, decodeBase64 } from "./attachments";

// "/" serves the static page (no data). "/api/web/*" is the page's data API: Chrona checks the user's key before it
// forwards a request here; other applications are reached through routed calls (v2-8).
type Args = Record<string, unknown>;
type UserTool = { target: string; moduleId?: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> | null };
type TargetPin = { moduleId: string };
const files: Record<string, string> = { "/app.js": "text/javascript; charset=utf-8", "/pages.js": "text/javascript; charset=utf-8", "/style.css": "text/css; charset=utf-8" };
const headers = { "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "same-origin",
  "content-security-policy": "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; frame-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
const preferences = createPreferences(chrona.paths.data);
const call = (target: string, args: Args = {}, options: { key?: string } = {}) => target === "web.settings" ? preferences.tool(args) : applicationCall(target, Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)), /^modules\.(enable|disable|rollback|remove)$/.test(target) ? { key: typeof args.requestKey === "string" ? args.requestKey : crypto.randomUUID() } : options);
const ownSettings = new Map<string, (args: Args) => Promise<unknown>>([
  ["web.ui-settings", args => webSettings(call, preferences, args)],
  ["web.ui-preferences", args => webPreferences(call, args)],
]);
const STATUS: Record<string, number> = { forbidden: 403, not_found: 404, invalid: 400, undeclared: 403, cycle: 409, conflict: 409, unknown: 409, unavailable: 503 };
const NO_ROUTE = Symbol("no-route");
type ApiContext = { request: Request; url: URL; path: string[]; body: Args; route: string };
type ApiResult = unknown | typeof NO_ROUTE;
type ApiHandler = (context: ApiContext) => Promise<ApiResult>;

// Replies to web conversations arrive as web.reply calls (v2-7 §4) and go to every open page over SSE.
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>(), encoder = new TextEncoder();
let ping: ReturnType<typeof setInterval> | undefined;
function send(chunk: string) {
  for (const stream of streams) try { stream.enqueue(encoder.encode(chunk)); } catch { streams.delete(stream); }
}
const attachments = createAttachments(chrona.paths.content);
const conversations = createAgentConversations({ dataDir: chrona.paths.data, call, deliveryPages: () => readDeliveryPages(pages), reply: event => send(`data: ${JSON.stringify({ type: "reply", ...event })}\n\n`) });
let polling = false;
setInterval(() => {
  if (polling) return;
  polling = true;
  void conversations.poll().catch(error => console.error(JSON.stringify({ component: "web", event: "conversation_poll_failed", error: String(error).slice(0, 300) }))).finally(() => { polling = false; });
}, 1000);
function events() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      controller = stream; streams.add(stream);
      // The ping keeps the stream under the servers' idle timeouts.
      ping ??= setInterval(() => send(": ping\n\n"), 5000);
    },
    cancel() {
      streams.delete(controller);
      if (!streams.size && ping) { clearInterval(ping); ping = undefined; }
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}
// Pages apps register (module-dependency-direction §4); `tools` is what this page may call of that app.
const pages = createPages({ dataDir: chrona.paths.data, modules: () => call("modules.list").then(page => (page as { items: unknown }).items) as Promise<ModuleState[]>,
  toolInventory: () => call("modules.describe", { audience: "user" }).then(page => (page as { items: (PageTool & { target: string })[] }).items),
  tools: async module => {
  const tools = await call("modules.describe", { query: module, audience: "user" }).then(page => (page as { items: unknown }).items) as (PageTool & { target: string })[];
  return new Map(tools.filter(tool => tool.target.startsWith(`${module}.`)).map(tool => [tool.target.slice(module.length + 1), tool]));
} });
on("tool", async (event: { id: string; args: Args; caller?: Caller }) => {
  // Chrona records the caller of every routed call; only the build's smoke start sends a tool event without one.
  if (event.id === "settings") return { result: event.caller ? await preferences.tool(event.args) : { ignored: "no caller" } };
  const own = ownSettings.get(`web.${event.id}`);
  if (own) return { result: event.caller ? await own(event.args) : { ignored: "no caller" } };
  if (event.id === "today") return { result: event.caller ? await todayView(call, getSessions) : { ignored: "no caller" } };
  if (event.id !== "reply") return { result: event.caller || event.id === "catalog" ? await pages.tool(event.id, event.args, event.caller) : { ignored: "no caller" } };
  send(`data: ${JSON.stringify({ type: "reply", ...event.args })}\n\n`);
  // Pages read the conversation when they open, so a reply with no page open is not lost.
  return { result: { pages: streams.size } };
});

on("activated", async () => {
  const modules = await call("modules.list").then(page => (page as { items: unknown }).items) as ModuleState[];
  const own = modules.find(module => module.name === "web" && module.status === "active" && module.activeHash);
  if (own) await pages.tool("page-set", WEB_SETTINGS_PAGE, { kind: "module", module: "web", moduleId: own.id });
});

const getSessions = () => conversations.list();
async function getSettings() {
  return settingsView(call);
}
async function sessionRoute({ request, path, body }: ApiContext): Promise<ApiResult> {
  if (path[0] !== "sessions" || path.length !== 3) return NO_ROUTE;
  if (request.method === "GET") return readConversation(path[1]!, path[2]!);
  if (request.method !== "POST") return NO_ROUTE;
  if (path[2] === "reconcile") {
    const parsed = z.object({ requestKey: z.string().min(1) }).strict().safeParse(body);
    if (!parsed.success) throw Object.assign(new Error("消息核对请求参数无效"), { code: "invalid" });
    return conversations.reconcile(path[1]!, parsed.data);
  }
  if (path[2] === "continue") {
    if (Object.keys(body).some(key => key !== "runId" && key !== "requestKey") || typeof body.runId !== "string" || typeof body.requestKey !== "string") throw Object.assign(new Error("继续请求参数无效"), { code: "invalid" });
    return conversations.continue(path[1]!, { runId: body.runId, requestKey: body.requestKey });
  }
  return NO_ROUTE;
}
function readConversation(session: string, part: string): Promise<ApiResult> | typeof NO_ROUTE {
  if (!isAgentConversation(session)) return NO_ROUTE;
  if (part === "snapshot") return conversations.snapshot(session);
  if (part === "transcript") return conversations.transcript(session);
  if (part === "messages") return conversations.messages(session);
  if (part === "execution") return conversations.execution(session);
  return NO_ROUTE;
}
async function approvalRoute({ request, path, body }: ApiContext): Promise<ApiResult> {
  if (request.method === "POST" && path[0] === "approvals" && path[2] === "resolve" && path.length === 3) {
    if (Object.keys(body).some(key => key !== "decision") || body.decision !== "approve" && body.decision !== "deny") throw Object.assign(new Error("审批参数无效"), { code: "invalid" });
    return call("approvals.resolve", { approval: path[1], decision: body.decision });
  }
  return NO_ROUTE;
}
async function settingsRoute({ request, path }: ApiContext): Promise<ApiResult> {
  if (request.method === "POST" && path[0] === "preferences" && path[2] === "forget" && path.length === 3) return memoryForget(call, "web", path[1]);
  return NO_ROUTE;
}
/** A credential the user typed goes straight to the kernel (v2-16); the page never reads one back. */
async function secretRoute({ request, path, body }: ApiContext): Promise<ApiResult> {
  if (request.method !== "POST" || path[0] !== "secrets") return NO_ROUTE;
  // The page saves field by field: what is left blank keeps its saved value (v2-16 §2.1).
  if (path.length === 2) return call("secrets.set", { name: path[1], value: body.value, merge: true });
  if (path[2] === "remove" && path.length === 3) return call("secrets.remove", { name: path[1], ...(typeof body.field === "string" ? { field: body.field } : {}) });
  // v2-30 §4: the scopes come from the declaring app's manifest, shown on the page.
  if (path[2] === "authorize" && path.length === 3) return call("secrets.authorize", { name: path[1], provider: body.provider, scopes: typeof body.scopes === "string" ? body.scopes.split(/\s+/).filter(Boolean) : body.scopes, ...(body.account ? { account: body.account } : {}) });
  return NO_ROUTE;
}
async function runRoute({ request, path, body }: ApiContext): Promise<ApiResult> {
  if (request.method === "POST" && path[0] === "interactions" && path[2] === "answer" && path.length === 3) {
    return conversations.answer(path[1]!, body);
  }
  if (request.method === "POST" && path[0] === "runs" && path[2] === "cancel" && path.length === 3) {
    return conversations.interrupt(path[1]!);
  }
  return NO_ROUTE;
}
// /modules/<module>/<view>: read-only views, and (v2-23) one app's page in one read and its own settings.
const MODULE_ROUTES: Record<string, (module: string, body: Args) => Promise<unknown>> = {
  "GET diagnostics": module => call("modules.health", { moduleId: chrona.dependencies[module] ?? module, detail: true }).then(page => (page as { items: unknown }).items),
  "GET overview": module => appOverview(call, module),
  "POST disable": module => call("modules.disable", { moduleId: module, reason: "用户在网页操作" }),
  "POST enable": module => call("modules.enable", { moduleId: module, reason: "用户在网页操作" }),
  "POST remove": module => call("modules.remove", { moduleId: module, reason: "用户在网页申请删除应用" }),
  "POST rollback": (module, body) => call("modules.rollback", { moduleId: module, hash: body.hash, reason: "用户在网页回滚应用" }),
};
async function moduleRoute({ request, path, body }: ApiContext): Promise<ApiResult> {
  const route = `${request.method} ${path[2]}`;
  if (path[0] !== "modules" || path.length !== 3 || !Object.hasOwn(MODULE_ROUTES, route)) return NO_ROUTE;
  return MODULE_ROUTES[route]!(path[1]!, body);
}
async function pageRoute({ request, path, url }: ApiContext): Promise<ApiResult> {
  if (request.method === "GET" && path[0] === "components" && path.length === 3) {
    const component = await pages.component(path[1]!, path[2]!, url.searchParams.get("revision"));
    return Response.json(component, { headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  }
  if (request.method !== "GET" || path[0] !== "pages" || path.length !== 3) return NO_ROUTE;
  const page = await pages.get(path[1]!, path[2]!);
  if (!page) throw Object.assign(new Error("没有这个页面"), { code: "not_found" });
  return page;
}
const listPages = () => pages.list();
const dynamicRoutes: ApiHandler[] = [sessionRoute, approvalRoute, settingsRoute, secretRoute, runRoute, moduleRoute, pageRoute];

async function api(request: Request, path: string[]) {
  const url = new URL(request.url), body = request.method === "POST" ? await request.json() as Args : {};
  const context: ApiContext = { request, url, path, body, route: `${request.method} /${path.join("/")}` };
  const routes: Record<string, ApiHandler> = {
    "GET /today": () => todayView(call, getSessions),
    "GET /sessions": () => getSessions(),
    "GET /history": async () => (await getSessions()).slice(0, 100),
    "POST /chat": async () => {
      // Only this entry's conversations accept new messages.
      if (body.session && !isAgentConversation(String(body.session))) throw Object.assign(new Error("此记录不能继续对话，请新建会话。"), { code: "conflict" });
      return conversations.send({ session: typeof body.session === "string" ? body.session : undefined, text: body.text, requestKey: typeof body.requestKey === "string" ? body.requestKey : undefined, attachments: await attachments.accept(body.attachments) });
    },
    "GET /settings": () => getSettings(),
    "POST /settings": () => updateSettings(call, body),
    "GET /runs": async () => [...await conversations.runs(), ...await call("activity.runs").then(page => (page as { items: unknown }).items) as unknown[]],
    // v2-18: the kernel's activity trail, worded by the kernel; the page only shows it.
    "GET /activity": () => call("notify.activity", { ...(url.searchParams.get("module") ? { module: url.searchParams.get("module") } : {}), ...(url.searchParams.get("before") ? { before: url.searchParams.get("before") } : {}) }),
    "GET /modules": () => call("modules.list").then(page => (page as { items: unknown }).items),
    "GET /credentials": () => call("secrets.list").then(page => (page as { items: unknown }).items),
    "GET /pages": () => listPages(),
    // Memory discovery and selection belong to this entry application.
    "GET /memory": () => memoryView(call, "web", url.searchParams.get("query") ?? undefined),
    "POST /memory/forget": () => memoryForget(call, "web", body.id),
    "GET /system-apps": () => systemApps(call, url.searchParams.get("module") ?? undefined),
    "GET /tools": () => call("modules.describe", { query: url.searchParams.get("query") ?? undefined, audience: "user" }).then(page => (page as { items: unknown }).items),
    "POST /call": () => moduleCall(body),
  };
  if (Object.hasOwn(routes, context.route)) return routes[context.route]!(context);
  for (const route of dynamicRoutes) {
    const result = await route(context);
    if (result !== NO_ROUTE) return result;
  }
  throw Object.assign(new Error(`No route ${context.route}`), { code: "not_found" });
}
async function moduleCall(body: Args) {
  // Conversations, approvals and app records have their own routes above.
  const target = String(body.target), args = (body.args ?? {}) as Args;
  if (!/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$/.test(target) || /^(approvals|modules|settings|schedules|secrets)\./.test(target)) throw Object.assign(new Error(`Unknown module tool ${target}`), { code: "not_found" });
  if (body.page && typeof body.page === "object") {
    const ref = body.page as { module: string; id: string; revision: string }, page = await pages.get(ref.module, ref.id);
    if (!page || page.revision !== ref.revision || !target.startsWith(`${page.module}.`) || !pageToolNames(page).includes(target.slice(page.module.length + 1))) throw Object.assign(new Error("页面或工具已变化，请重新打开页面"), { code: "conflict" });
    const expectedTarget = { moduleId: page.moduleId };
    // pages.get already validated current user-visible tools. The routed
    // call rechecks admission and module identity atomically; local settings still
    // need their in-process input/output validation below.
    if (!ownSettings.has(target)) return applicationCall(target, args, { expectedTarget });
    return invokeUserTool(target, args, await userTool(target), expectedTarget);
  }
  const tool = await userTool(target);
  return invokeUserTool(target, args, tool, tool.moduleId ? { moduleId: tool.moduleId } : undefined);
}
async function invokeUserTool(target: string, args: Args, tool: UserTool, expectedTarget?: TargetPin) {
  const own = ownSettings.get(target);
  if (!own) return applicationCall(target, args, expectedTarget ? { expectedTarget } : undefined);
  // Discovery admits the actual SDK caller against its current approved owner authority.
  // Own business dispatch avoids a routed self-call, retaining the page's module identity.
  if (!expectedTarget || tool.moduleId !== expectedTarget.moduleId) throw Object.assign(new Error("页面或工具已变化，请重新打开页面"), { code: "conflict" });
  const input = z.fromJSONSchema(tool.inputSchema).safeParse(args);
  if (!input.success) throw Object.assign(new Error("Invalid tool arguments"), { code: "invalid" });
  const output = await own(input.data as Args);
  if (tool.outputSchema && !z.fromJSONSchema(tool.outputSchema).safeParse(output).success) throw Object.assign(new Error(`${target}: output contract mismatch`), { code: "failed" });
  return output;
}
async function userTool(target: string) {
  const tools = await call("modules.describe", { query: target, audience: "user" }).then(page => (page as { items: unknown }).items) as UserTool[];
  const tool = tools.find(tool => tool.target === target);
  if (!tool) throw Object.assign(new Error(`Unknown user tool ${target}`), { code: "not_found" });
  return tool;
}
async function fileResponse(request: Request) {
  // A conversation's attachment, served as a download: never rendered as a page of this origin.
  const url = new URL(request.url);
  try {
    const messageId = url.searchParams.get("message"), ref = url.searchParams.get("ref");
    const file = messageId && ref ? await conversations.attachment(messageId, ref) : undefined;
    if (file && typeof file === "object" && "ref" in file && typeof file.ref === "string") {
      return new Response(await attachments.read(file.ref), { headers: { "content-type": "application/octet-stream", "content-disposition": "attachment", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'" } });
    }
    throw Object.assign(new Error("附件不属于这条 Web 消息"), { code: "not_found" });
  } catch (error) {
    return apiError(error);
  }
}
function validPageContentRef(ref: string, module: string) {
  return ref.startsWith(`${module}/`) && !ref.split("/").some(part => !part || part === "." || part === "..") && !ref.includes("\\") && !Array.from(ref).some(char => char < " ");
}
function rasterResponse(file: { base64: string; mime: string } | null, imageHeaders: Record<string, string>) {
  if (!file) return new Response("没有这张图片", { status: 404, headers: imageHeaders });
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mime)) return new Response("不支持的图片类型", { status: 403, headers: imageHeaders });
  const bytes = decodeBase64(file.base64, 8 * 1024 * 1024);
  const raster = file.mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : file.mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : file.mime === "image/gif" ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())
    : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!raster) return new Response("图片内容无效", { status: 403, headers: imageHeaders });
  return new Response(bytes, { headers: { ...imageHeaders, "content-type": file.mime } });
}
/** Only the registering app's raster images may be displayed on its page. Auth is the /api/* entry's. */
async function pageContentResponse(request: Request, module: string, id: string) {
  const imageHeaders = { "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "cache-control": "private, no-cache" };
  try {
    const page = await pages.get(module, id);
    if (!page) return new Response("没有这张图片", { status: 404, headers: imageHeaders });
    const ref = new URL(request.url).searchParams.get("ref") ?? "";
    if (!page.content || !validPageContentRef(ref, page.module)) return new Response("只能读取本应用声明的图片", { status: 403, headers: imageHeaders });
    const file = await chrona.call({ moduleId: page.moduleId, tool: page.content.tool }, { ref }, { expectedTarget: { moduleId: page.moduleId } }) as { base64: string; mime: string } | null;
    return rasterResponse(file, imageHeaders);
  } catch (error) {
    const { code } = error as { code?: string };
    const status = code === "conflict" ? 409 : code === "not_found" ? 404 : 502;
    return new Response(status === 409 ? "页面已失效，请恢复应用或重新登记页面" : status === 404 ? "没有这张图片" : "页面状态读取失败，请稍后核对", { status, headers: imageHeaders });
  }
}
function apiError(error: unknown) {
  const { code = "failed", message = "failed" } = error as { code?: string; message?: string };
  return Response.json({ code, message }, { status: STATUS[code] ?? 502 });
}
async function apiResponse(request: Request, path: string[]) {
  const parts = path.join("/");
  if (request.method === "GET") {
    if (parts === "events") return events();
    if (parts === "file") return fileResponse(request);
    if (path.length === 4 && path[0] === "pages" && path[3] === "content") return pageContentResponse(request, path[1]!, path[2]!);
  }
  try {
    if (request.method === "POST" && parts === "attachments") return Response.json(await attachments.upload(await attachmentBody(request)));
    const result = await api(request, path);
    return result instanceof Response ? result : Response.json(result ?? null);
  }
  catch (error) { return apiError(error); }
}
async function serve(request: Request) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/web/")) return apiResponse(request, path.slice("/api/web/".length).split("/").filter(Boolean).map(decodeURIComponent));
  const name = files[path] ? path.slice(1) : "index.html";
  const body = await readFile(join(chrona.paths.module, name));
  return new Response(request.method === "HEAD" ? null : body, { headers: { ...headers, "content-type": files[path] ?? "text/html; charset=utf-8" } });
}

chrona.serve(serve);

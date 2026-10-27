// @ts-expect-error Chrona supplies the SDK package at run time.
import { chrona, on } from "chrona";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// "/" serves the static page (no data). "/api/web/*" is the page's data API: Chrona checks the user's key before it
// forwards a request here, and every answer comes from routed calls (v2-8).
type Args = Record<string, unknown>;
const files: Record<string, string> = { "/app.js": "text/javascript; charset=utf-8", "/style.css": "text/css; charset=utf-8" };
const headers = { "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "same-origin",
  "content-security-policy": "default-src 'self'; img-src 'self' blob: data:; frame-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
const call = (target: string, args: Args = {}) => chrona.call(target, Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)));
const STATUS: Record<string, number> = { forbidden: 403, not_found: 404, invalid: 400, undeclared: 403, cycle: 409 };
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
on("tool", async (event: { id: string; args: Args }) => {
  if (event.id !== "reply") throw new Error(`Unknown tool ${event.id}`);
  send(`data: ${JSON.stringify({ type: "reply", ...event.args })}\n\n`);
  // Pages read the conversation when they open, so a reply with no page open is not lost.
  return { result: { pages: streams.size } };
});

async function getSessions() {
  // Web conversations and module builds (v2-13), newest first.
  const lists = await Promise.all(["web", "build"].map(source => call("chat.sessions", { source, status: "active" }) as Promise<{ lastActivityAt: string }[]>));
  return lists.flat().sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}
async function getSettings() {
  // Settings page (v2-9): settings, grant rules, preferences, schedules and credentials (v2-16, names only) in one read.
  const [settings, grants, preferences, schedules, secrets] = await Promise.all([call("settings.get"), call("settings.grants"), call("settings.preferences"), call("schedules.list"), call("secrets.list")]);
  return { settings, grants, preferences, schedules, secrets };
}
async function sessionRoute({ request, path, body }: ApiContext): Promise<ApiResult> {
  if (path[0] !== "sessions") return NO_ROUTE;
  if (request.method === "GET" && path[2] === "transcript" && path.length === 3) return call("chat.transcript", { session: path[1] });
  if (request.method === "GET" && path[2] === "messages" && path.length === 3) return call("chat.messages", { session: path[1], limit: 100 });
  if (request.method === "POST" && path.length === 3 && ["stop-build", "revise-build"].includes(path[2]!)) return call(`modules.${path[2]}`, { session: path[1], ...(path[2] === "revise-build" ? { requirements: body.requirements } : {}) });
  return NO_ROUTE;
}
async function approvalRoute({ request, path, body }: ApiContext): Promise<ApiResult> {
  if (request.method === "POST" && path[0] === "approvals" && path[2] === "resolve" && path.length === 3) return call("approvals.resolve", { approval: path[1], decision: body.decision, scope: body.scope });
  return NO_ROUTE;
}
async function settingsRoute({ request, path, body }: ApiContext): Promise<ApiResult> {
  if (request.method === "POST" && path[0] === "grants" && path[2] === "revoke" && path.length === 3) return call("settings.revoke-grant", { grant: path[1] });
  if (request.method === "POST" && path[0] === "preferences" && path[2] === "forget" && path.length === 3) return call("settings.forget", { preference: path[1] });
  if (request.method === "POST" && path[0] === "schedules" && path.length === 2) return call("schedules.update", { schedule: path[1], status: body.status });
  return NO_ROUTE;
}
/** A credential the user typed goes straight to the kernel (v2-16); the page never reads one back. */
async function secretRoute({ request, path, body }: ApiContext): Promise<ApiResult> {
  if (request.method !== "POST" || path[0] !== "secrets") return NO_ROUTE;
  if (path.length === 2) return call("secrets.set", { name: path[1], value: JSON.stringify(body.value) });
  if (path[2] === "remove" && path.length === 3) return call("secrets.remove", { name: path[1] });
  return NO_ROUTE;
}
async function runRoute({ request, path, body }: ApiContext): Promise<ApiResult> {
  if (request.method === "POST" && path[0] === "interactions" && path[2] === "answer" && path.length === 3) return call("chat.answer", { interaction: path[1], answer: JSON.stringify(body) });
  if (request.method === "POST" && path[0] === "runs" && path[2] === "cancel" && path.length === 3) return call("chat.cancel", { run: path[1] });
  return NO_ROUTE;
}
async function moduleRoute({ request, path }: ApiContext): Promise<ApiResult> {
  if (request.method === "GET" && path[0] === "modules" && path[2] === "diagnostics" && path.length === 3) return call("modules.diagnostics", { module: path[1] });
  return NO_ROUTE;
}
const dynamicRoutes: ApiHandler[] = [sessionRoute, approvalRoute, settingsRoute, secretRoute, runRoute, moduleRoute];

async function api(request: Request, path: string[]) {
  const url = new URL(request.url), body = request.method === "POST" ? await request.json() as Args : {};
  const context: ApiContext = { request, url, path, body, route: `${request.method} /${path.join("/")}` };
  const routes: Record<string, ApiHandler> = {
    "GET /today": () => call("chat.today"),
    "GET /sessions": () => getSessions(),
    "POST /chat": async () => {
      // An existing conversation continues under its key; without one the first message starts a new conversation.
      const key = body.session ? (await call("chat.session", { session: body.session }) as { key: string }).key : `web:${crypto.randomUUID()}`;
      return call("chat.send", { key, text: body.text, channel: "in_app" });
    },
    "GET /settings": () => getSettings(),
    "POST /settings": () => call("settings.update", { settings: JSON.stringify(body) }),
    "GET /runs": () => call("chat.runs"),
    "GET /modules": () => call("modules.list"),
    "GET /tools": () => call("modules.tools", { query: url.searchParams.get("query") ?? undefined }),
    "POST /call": () => moduleCall(body),
  };
  if (Object.hasOwn(routes, context.route)) return routes[context.route]!(context);
  for (const route of dynamicRoutes) {
    const result = await route(context);
    if (result !== NO_ROUTE) return result;
  }
  throw Object.assign(new Error(`No route ${context.route}`), { code: "not_found" });
}
function moduleCall(body: Args) {
  // Conversations, approvals and app records have their own routes above.
  const target = String(body.target);
  if (!/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$/.test(target) || /^(chat|approvals|modules|settings|schedules|secrets)\./.test(target)) throw Object.assign(new Error(`Unknown module tool ${target}`), { code: "not_found" });
  return chrona.call(target, (body.args ?? {}) as Args);
}
async function fileResponse(request: Request) {
  // A conversation's attachment, served as a download: never rendered as a page of this origin.
  const url = new URL(request.url);
  try {
    const file = await call("chat.file", { message: url.searchParams.get("message") ?? "", ref: url.searchParams.get("ref") ?? "" }) as { base64: string; mime: string };
    return new Response(Buffer.from(file.base64, "base64"), { headers: { "content-type": file.mime, "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'" } });
  } catch (error) {
    return apiError(error);
  }
}
function apiError(error: unknown) {
  const { code = "failed", message = "failed" } = error as { code?: string; message?: string };
  return Response.json({ code, message }, { status: STATUS[code] ?? 502 });
}
async function apiResponse(request: Request, path: string[]) {
  const parts = path.join("/");
  if (request.method === "GET" && parts === "events") return events();
  if (request.method === "GET" && parts === "file") return fileResponse(request);
  try { return Response.json(await api(request, path) ?? null); }
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

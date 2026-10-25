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

async function api(request: Request, path: string[]) {
  const url = new URL(request.url), body = request.method === "POST" ? await request.json() as Args : {};
  const route = `${request.method} /${path.join("/")}`;
  if (route === "GET /today") return call("chat.today");
  if (route === "GET /sessions") {
    // Web conversations and module builds (v2-13), newest first.
    const lists = await Promise.all(["web", "build"].map(source => call("chat.sessions", { source, status: "active" }) as Promise<{ lastActivityAt: string }[]>));
    return lists.flat().sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }
  if (request.method === "GET" && path[0] === "sessions" && path[2] === "transcript" && path.length === 3) return call("chat.transcript", { session: path[1] });
  if (request.method === "GET" && path[0] === "sessions" && path[2] === "messages" && path.length === 3) return call("chat.messages", { session: path[1], limit: 100 });
  if (route === "POST /chat") {
    // An existing conversation continues under its key; without one the first message starts a new conversation.
    const key = body.session ? (await call("chat.session", { session: body.session }) as { key: string }).key : `web:${crypto.randomUUID()}`;
    return call("chat.send", { key, text: body.text, channel: "in_app" });
  }
  if (request.method === "POST" && path[0] === "approvals" && path[2] === "resolve" && path.length === 3) return call("approvals.resolve", { approval: path[1], decision: body.decision, scope: body.scope });
  // Settings page (v2-9): settings, grant rules, preferences and schedules in one read.
  if (route === "GET /settings") {
    const [settings, grants, preferences, schedules] = await Promise.all([call("settings.get"), call("settings.grants"), call("settings.preferences"), call("schedules.list")]);
    return { settings, grants, preferences, schedules };
  }
  if (route === "POST /settings") return call("settings.update", { settings: JSON.stringify(body) });
  if (request.method === "POST" && path[0] === "grants" && path[2] === "revoke" && path.length === 3) return call("settings.revoke-grant", { grant: path[1] });
  if (request.method === "POST" && path[0] === "preferences" && path[2] === "forget" && path.length === 3) return call("settings.forget", { preference: path[1] });
  if (request.method === "POST" && path[0] === "schedules" && path.length === 2) return call("schedules.update", { schedule: path[1], status: body.status });
  // Provider runs: questions waiting for the user, and stopping a run.
  if (route === "GET /runs") return call("chat.runs");
  if (request.method === "POST" && path[0] === "interactions" && path[2] === "answer" && path.length === 3) return call("chat.answer", { interaction: path[1], answer: JSON.stringify(body) });
  if (request.method === "POST" && path[0] === "runs" && path[2] === "cancel" && path.length === 3) return call("chat.cancel", { run: path[1] });
  if (route === "GET /modules") return call("modules.list");
  if (route === "GET /tools") return call("modules.tools", { query: url.searchParams.get("query") ?? undefined });
  if (route === "POST /call") {
    // Conversations, approvals and app records have their own routes above.
    const target = String(body.target);
    if (!/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,40}$/.test(target) || /^(chat|approvals|modules|settings|schedules)\./.test(target)) throw Object.assign(new Error(`Unknown module tool ${target}`), { code: "not_found" });
    return chrona.call(target, (body.args ?? {}) as Args);
  }
  throw Object.assign(new Error(`No route ${route}`), { code: "not_found" });
}

chrona.serve(async (request: Request) => {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/web/")) {
    const parts = path.slice("/api/web/".length).split("/").filter(Boolean).map(decodeURIComponent);
    if (request.method === "GET" && parts.join("/") === "events") return events();
    if (request.method === "GET" && parts.join("/") === "file") {
      // A conversation's attachment, served as a download: never rendered as a page of this origin.
      const url = new URL(request.url);
      try {
        const file = await call("chat.file", { message: url.searchParams.get("message") ?? "", ref: url.searchParams.get("ref") ?? "" }) as { base64: string; mime: string };
        return new Response(Buffer.from(file.base64, "base64"), { headers: { "content-type": file.mime, "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'" } });
      } catch (error) {
        const { code = "failed", message = "failed" } = error as { code?: string; message?: string };
        return Response.json({ code, message }, { status: STATUS[code] ?? 502 });
      }
    }
    try { return Response.json(await api(request, parts) ?? null); }
    catch (error) {
      const { code = "failed", message = "failed" } = error as { code?: string; message?: string };
      return Response.json({ code, message }, { status: STATUS[code] ?? 502 });
    }
  }
  const name = files[path] ? path.slice(1) : "index.html";
  const body = await readFile(join(chrona.paths.module, name));
  return new Response(request.method === "HEAD" ? null : body, { headers: { ...headers, "content-type": files[path] ?? "text/html; charset=utf-8" } });
});

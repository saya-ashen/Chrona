import { z } from "zod";
import { APPROVAL_SCOPES, APPROVAL_STATUSES, attachmentSchema, DELIVERY_CHANNELS, moduleManifestSchema, relativePathSchema, SESSION_SOURCES, SESSION_STATUSES } from "@chrona/contracts/steward";
import { createChat } from "./chat";
import { createSessions } from "./sessions";
import { contentArea } from "./content";
import { createApprovals } from "./approvals";
import { createModules } from "./modules";
import { workspaceToday } from "./today";
import { admitted, CallError, registerSystemModule, type Caller, type Json, type SystemModule, type Tool } from "./module-calls";
import { parseInput } from "./errors";

type Properties = Tool["parameters"]["properties"];
const tool = (name: string, description: string, properties: Properties, required: string[], extra: Partial<Tool> = {}): Tool =>
  ({ name, description, parameters: { type: "object", properties, required }, visibility: ["modules"], idempotent: false, ...extra });
const text = (description?: string) => ({ type: "string" as const, ...(description ? { description } : {}) });
/** Conversations and approvals act for the user: only a module (its manifest `uses`, approved with it) may call them. */
function entry(caller: Caller) {
  if (caller.kind !== "module") throw new CallError("forbidden", "Only an entry module may call this");
  return caller;
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;

/** `chat`: the conversation service for entry modules (qq). Replies come back as `<entry>.reply` calls (chat-replies). */
const chat: SystemModule = {
  name: "chat",
  tools: [
    tool("send", "Record the user's message in a conversation and run it; returns at once, replies are pushed to the calling module's reply tool.",
      { key: text("Conversation key, e.g. qq:dm"), text: text(), channel: { type: "string", enum: [...DELIVERY_CHANNELS] }, "external-id": text("Transport message id (deduplicates redelivery)"),
        "quoted-external-id": text("Transport id of the quoted message"), attachments: text("JSON array of attachments from chat.attach") }, ["key", "text", "channel"]),
    tool("attach", "Store one received file (base64, at most 20 MiB) and return an attachment for chat.send.", { name: text(), mime: text(), base64: text() }, ["name", "mime", "base64"]),
    tool("new-session", "End the active conversation for a key; the next message starts a new one.", { key: text() }, ["key"], { idempotent: true }),
    tool("file", "Bytes (base64) of a file attached to a reply in one of the caller's conversations.", { message: text("Reply message id"), ref: text("Attachment ref <app>/<path>") }, ["message", "ref"], { idempotent: true }),
    tool("delivered", "Record the transport id of a reply the caller delivered (for quotes).", { message: text(), "external-id": text() }, ["message", "external-id"], { idempotent: true }),
    tool("record", "Record a message the caller delivered outside a reply (e.g. a notification) into its conversation.", { key: text(), channel: { type: "string", enum: [...DELIVERY_CHANNELS] }, text: text(), "external-id": text() }, ["key", "channel", "text", "external-id"], { idempotent: true }),
    // Request/response entries (MCP): the conversation gets no entry module, so nothing is pushed and background results are notified.
    tool("ask", "Send the user's message by session or key (without either, a new conversation) and wait for this run's replies.", { text: text(), session: text("Session id"), key: text("Conversation key") }, ["text"]),
    tool("sessions", "The user's conversations, most recent first.", { source: { type: "string", enum: [...SESSION_SOURCES] }, status: { type: "string", enum: [...SESSION_STATUSES] } }, [], { idempotent: true }),
    tool("session", "One conversation.", { session: text() }, ["session"], { idempotent: true }),
    tool("session-update", "Rename or end a conversation.", { session: text(), title: text(), status: { type: "string", enum: ["ended"] } }, ["session"], { idempotent: true }),
    tool("today", "The user's overview: approvals waiting, the next 7 days of schedules, recent notifications, apps, recent conversations and health.", {}, [], { idempotent: true }),
    tool("messages", "A conversation's recent messages, oldest first.", { session: text(), limit: { type: "number", description: "1-200, default 50" } }, ["session"], { idempotent: true }),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    const module = entry(caller), { db } = ports;
    const service = createChat(ports, async () => { await ports.onQueued?.(); });
    // Only conversations this module brings: another entry's conversation is not its to read or mark.
    const own = async (sessionId: string) => (await db.session.findFirst({ where: { id: sessionId, workspaceId } }))?.entryModuleId === module.moduleId;
    switch (name) {
      case "send": {
        // Another entry's conversation is not this module's to speak in (or to take its replies).
        const session = await db.session.findFirst({ where: { workspaceId, key: String(args.key), status: "active" } });
        if (session?.entryModuleId && session.entryModuleId !== module.moduleId) throw new CallError("forbidden", "Conversation belongs to another entry");
        let raw: unknown = [];
        try { if (args.attachments !== undefined) raw = JSON.parse(String(args.attachments)); } catch { throw new CallError("invalid", "attachments must be a JSON array"); }
        const attachments = parseInput(z.array(attachmentSchema.extend({ base64: z.string().optional() })).max(10), raw);
        return json(await service.accept({ workspaceId, key: String(args.key), text: String(args.text), channel: args.channel as (typeof DELIVERY_CHANNELS)[number], attachments,
          ...(args["external-id"] ? { externalId: String(args["external-id"]) } : {}), ...(args["quoted-external-id"] ? { quotedExternalId: String(args["quoted-external-id"]) } : {}) }, module.moduleId));
      }
      case "attach": {
        const base64 = String(args.base64);
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64) || base64.length > 28_000_000) throw new CallError("invalid", "Attachment must be base64, at most 20 MiB");
        const result = await service.intakeAttachments({ workspaceId, channel: "in_app" }, [{ name: String(args.name), mime: String(args.mime), bytes: Buffer.from(base64, "base64") }]);
        return json(result.attachments[0]);
      }
      case "new-session": return json(await createSessions(ports, workspaceId).new({ key: String(args.key) }));
      case "ask": return json(await service.handleMessage({ workspaceId, channel: "in_app", text: String(args.text), ...(args.session ? { sessionId: String(args.session) } : {}), ...(args.key ? { key: String(args.key) } : {}) }));
      case "today": return json(await workspaceToday(ports, workspaceId).get());
      case "sessions": return json(await createSessions(ports, workspaceId).list({ ...(args.source ? { source: args.source } : {}), ...(args.status ? { status: args.status } : {}) }));
      case "session": return json(await createSessions(ports, workspaceId).get(String(args.session)));
      case "session-update": return json(await createSessions(ports, workspaceId).update(String(args.session), { ...(args.title !== undefined ? { title: args.title } : {}), ...(args.status !== undefined ? { status: args.status } : {}) }));
      case "messages": return json(await createSessions(ports, workspaceId).messages(String(args.session), args.limit ?? 50));
      case "file": {
        const message = await db.message.findFirst({ where: { id: String(args.message), workspaceId, direction: "out" } });
        const ref = parseInput(z.string().max(542), args.ref), files = attachmentSchema.strip().array().catch([]).parse(message?.attachments ?? []);
        if (!message || !await own(message.sessionId) || !files.some(file => file.ref === ref)) throw new CallError("not_found", "No such file on a reply of yours");
        const [app, ...parts] = ref.split("/"), owner = await db.module.findFirst({ where: { workspaceId, name: app } });
        if (!owner) throw new CallError("not_found", "App not found");
        const file = await (await contentArea(ports, workspaceId, owner.id)).raw(relativePathSchema.parse(parts.join("/")));
        if (file.bytes.byteLength > 20 * 1024 * 1024) throw new CallError("invalid", "File larger than 20 MiB");
        return { base64: file.bytes.toString("base64"), mime: file.mime };
      }
      case "delivered": {
        const message = await db.message.findFirst({ where: { id: String(args.message), workspaceId, direction: "out" } });
        if (!message || !await own(message.sessionId)) throw new CallError("not_found", "Reply not found");
        return json(await service.setExternalId(workspaceId, message.id, String(args["external-id"])));
      }
      case "record": {
        const session = await db.session.findFirst({ where: { workspaceId, key: String(args.key), status: "active" } });
        if (session && !await own(session.id)) throw new CallError("forbidden", "Conversation belongs to another entry");
        return json(await service.recordMessage(workspaceId, { key: String(args.key), channel: args.channel as (typeof DELIVERY_CHANNELS)[number], text: String(args.text).slice(0, 8000), externalId: String(args["external-id"]) }));
      }
      default: throw new CallError("not_found", `chat.${name} not found`);
    }
  },
};

/** `approvals`: the user's decisions, for entry modules (QQ buttons and text commands). */
const approvals: SystemModule = {
  name: "approvals",
  tools: [
    tool("list", "Approvals, by status (default open).", { status: { type: "string", enum: [...APPROVAL_STATUSES] } }, [], { idempotent: true }),
    tool("resolve", "Approve or deny an approval as the user (only after the user decided).", { approval: text(), decision: { type: "string", enum: ["approve", "deny"] }, scope: { type: "string", enum: [...APPROVAL_SCOPES] } }, ["approval", "decision"]),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    const module = entry(caller), modules = createModules(ports, workspaceId);
    const service = createApprovals({ db: ports.db, workspaceId, now: ports.now }, async action => {
      const payload = action.payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.kind === "activate_module") await modules.onApproved(action);
      else await ports.onApproved?.(action);
    });
    if (name === "list") return json(await service.list((args.status as (typeof APPROVAL_STATUSES)[number] | undefined) ?? "open"));
    const source = module.module === "qq" || module.module === "mcp" || module.module === "web" ? module.module : "entry";
    if (name === "resolve") return json((await service.resolve(String(args.approval), { decision: args.decision, scope: args.scope ?? "once" }, source)).approval);
    throw new CallError("not_found", `approvals.${name} not found`);
  },
};

/** `modules`: what Chrona knows about the apps (versions, runs) and which tools a caller may reach; never what an app reports about itself. */
const modules: SystemModule = {
  name: "modules",
  tools: [
    tool("list", "Apps with their status, active and recent versions (with rejection reasons) and recent runs.", {}, [], { idempotent: true }),
    tool("tools", "Module tools the caller may call (<module>.<tool>, description, input schema); query matches every word against names and descriptions.", { query: text() }, [], { idempotent: true }),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    if (caller.kind !== "module") throw new CallError("forbidden", "Only a module may call this");
    if (name === "list") return json(await createModules(ports, workspaceId).list());
    if (name !== "tools") throw new CallError("not_found", `modules.${name} not found`);
    const words = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean), found = [];
    for (const module of await ports.db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, orderBy: { name: "asc" } })) {
      const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
      for (const candidate of moduleManifestSchema.safeParse(version?.manifest).data?.tools ?? []) {
        const target = `${module.name}.${candidate.name}`;
        if (!words.every(word => `${target} ${candidate.description}`.toLowerCase().includes(word)) || !await admitted(ports.db, caller, candidate, target)) continue;
        found.push({ target, description: candidate.description, inputSchema: { ...candidate.parameters, additionalProperties: false }, idempotent: candidate.idempotent });
      }
    }
    return json(found);
  },
};

let registered = false;
/** Called by the service: Chrona's system modules become routable call targets. */
export function registerSystemModules() {
  if (registered) return;
  registered = true;
  registerSystemModule(chat);
  registerSystemModule(approvals);
  registerSystemModule(modules);
}

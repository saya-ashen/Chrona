import { z } from "zod";
import { APPROVAL_SCOPES, APPROVAL_STATUSES, attachmentSchema, isEntryModule, providerAnswerSchema, DELIVERY_CHANNELS, moduleManifestSchema, SESSION_SOURCES, SESSION_STATUSES } from "@chrona/contracts/steward";
import { createChat, readChatFile } from "./chat";
import { createSessions } from "./sessions";
import { createApprovals } from "./approvals";
import { createModules } from "./modules";
import { workspaceToday } from "./today";
import { completeForModule } from "./module-model";
import { createRuns, createRunSession } from "./runs";
import { createProviderControl } from "./provider-channel";
import { createSettings } from "./settings";
import { createGrants } from "./grants";
import { createPreferences } from "./preferences";
import { createSchedules } from "./schedules";
import { createNotificationsView, forwardSettings } from "./notify-user";
import { admitted, CallError, registerSystemModule, type Caller, type Json, type SystemModule, type Tool } from "./module-calls";
import { parseInput } from "./errors";
import { storedAttachments } from "./store";
import type { StewardPorts } from "./ports";

type Properties = Tool["parameters"]["properties"];
const tool = (name: string, description: string, properties: Properties, required: string[], extra: Partial<Tool> = {}): Tool =>
  ({ name, description, parameters: { type: "object", properties, required }, visibility: ["modules"], idempotent: false, ...extra });
const text = (description?: string) => ({ type: "string" as const, ...(description ? { description } : {}) });
/** Conversations and approvals act for the user: only a module (its manifest `uses`, approved with it) may call them. */
function entry(caller: Caller) {
  if (caller.kind !== "module") throw new CallError("forbidden", "Only an entry module may call this");
  return caller;
}
const json = (value: unknown) => (value === undefined ? null : JSON.parse(JSON.stringify(value))) as Json;
/** Structured arguments travel as JSON text (tool parameters are scalars). */
function parsed(value: unknown, name: string) {
  try { return JSON.parse(String(value)) as unknown; } catch { throw new CallError("invalid", `${name} must be JSON`); }
}
async function callerManifest(db: StewardPorts["db"], caller: Extract<Caller, { kind: "module" }>) {
  const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: caller.moduleId, hash: caller.hash } } });
  return moduleManifestSchema.safeParse(version?.manifest).data ?? null;
}
const usesAll = async (db: StewardPorts["db"], caller: Extract<Caller, { kind: "module" }>) => (await callerManifest(db, caller))?.uses.includes("*") ?? false;

/** `chat`: the conversation service for entry modules (qq). Replies come back as `<entry>.reply` calls (chat-replies). */
const chat: SystemModule = {
  name: "chat",
  tools: [
    tool("send", "Record the user's message in a conversation and run it; returns at once, replies are pushed to the calling module's reply tool.",
      { key: text("Conversation key, e.g. qq:dm"), text: text(), channel: { type: "string", enum: [...DELIVERY_CHANNELS] }, "external-id": text("Transport message id (deduplicates redelivery)"),
        "quoted-external-id": text("Transport id of the quoted message"), attachments: text("JSON array of attachments from chat.attach") }, ["key", "text", "channel"]),
    tool("attach", "Store one received file (base64, at most 20 MiB) and return an attachment for chat.send.", { name: text(), mime: text(), base64: text() }, ["name", "mime", "base64"]),
    tool("new-session", "End the active conversation for a key; the next message starts a new one.", { key: text() }, ["key"], { idempotent: true }),
    tool("file", "Bytes (base64) of a file attached to a message in one of the caller's conversations.", { message: text("Message id"), ref: text("Attachment ref chat/<file>") }, ["message", "ref"], { idempotent: true }),
    tool("delivered", "Record the transport id of a reply the caller delivered (for quotes).", { message: text(), "external-id": text() }, ["message", "external-id"], { idempotent: true }),
    tool("record", "Record a message the caller delivered outside a reply (e.g. a notification) into its conversation.", { key: text(), channel: { type: "string", enum: [...DELIVERY_CHANNELS] }, text: text(), "external-id": text() }, ["key", "channel", "text", "external-id"], { idempotent: true }),
    // Request/response entries (MCP): the conversation gets no entry module, so nothing is pushed and background results are notified.
    tool("ask", "Send the user's message by session or key (without either, a new conversation) and wait for this run's replies.", { text: text(), session: text("Session id"), key: text("Conversation key") }, ["text"]),
    tool("sessions", "The user's conversations, most recent first.", { source: { type: "string", enum: [...SESSION_SOURCES] }, status: { type: "string", enum: [...SESSION_STATUSES] } }, [], { idempotent: true }),
    tool("session", "One conversation.", { session: text() }, ["session"], { idempotent: true }),
    tool("session-update", "Rename or end a conversation.", { session: text(), title: text(), status: { type: "string", enum: ["ended"] } }, ["session"], { idempotent: true }),
    tool("today", "The user's overview: approvals waiting, the next 7 days of schedules, recent notifications, apps, recent conversations and health.", {}, [], { idempotent: true }),
    tool("messages", "A conversation's recent messages, oldest first.", { session: text(), limit: { type: "number", description: "1-200, default 50" } }, ["session"], { idempotent: true }),
    tool("runs", "Recent Provider runs (progress, usage, questions waiting for the user), optionally of one conversation.", { session: text() }, [], { idempotent: true }),
    tool("answer", "Answer a question a running Provider asked the user.", { interaction: text(), answer: text('JSON {"decision":"submit","value":…} or {"decision":"cancel"}') }, ["interaction", "answer"]),
    tool("cancel", "Stop a running Provider run.", { run: text() }, ["run"], { idempotent: true }),
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
      case "runs": return json(await createProviderControl(ports, workspaceId).list(args.session ? String(args.session) : undefined));
      case "answer": return json(await createProviderControl(ports, workspaceId).answer(String(args.interaction), parseInput(providerAnswerSchema, parsed(args.answer, "answer"))));
      case "cancel": return json(await createProviderControl(ports, workspaceId).cancel(String(args.run)));
      case "file": {
        const message = await db.message.findFirst({ where: { id: String(args.message), workspaceId } });
        const ref = parseInput(z.string().max(542), args.ref), files = storedAttachments(message?.attachments ?? []);
        // A page offering everything to the user (`uses: ["*"]`, the web) reads files of every conversation.
        if (!message || !(await own(message.sessionId) || await usesAll(db, module)) || !files.some(file => file.ref === ref)) throw new CallError("not_found", "No such file on a message of yours");
        const file = await readChatFile(ports, ref);
        if (!file) throw new CallError("not_found", "File not found");
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

/** `settings`: the user's settings, grants and preferences, for entry modules (v2-9). */
const settings: SystemModule = {
  name: "settings",
  tools: [
    tool("get", "Notification settings and the module model (moduleModel).", {}, [], { idempotent: true }),
    tool("update", "Change notification settings and/or moduleModel.", { settings: text('JSON {"notifications"?: {...}, "moduleModel"?: {...} | null}') }, ["settings"], { idempotent: true }),
    tool("grants", "Grant rules (what Chrona may do without asking), active first.", {}, [], { idempotent: true }),
    tool("revoke-grant", "Revoke a grant rule.", { grant: text() }, ["grant"], { idempotent: true }),
    tool("preferences", "What Chrona remembers about the user.", {}, [], { idempotent: true }),
    tool("forget", "Delete a remembered preference.", { preference: text() }, ["preference"], { idempotent: true }),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    entry(caller);
    const ctx = { db: ports.db, workspaceId, now: ports.now }, notifications = createNotificationsView(ports, workspaceId);
    const service = createSettings(ctx, { status: notifications.status, forward: (tx, value, at) => forwardSettings(tx, ports, workspaceId, value, at) });
    switch (name) {
      case "get": return json(await service.get());
      case "update": return json(await service.update(parsed(args.settings, "settings")));
      case "grants": return json(await createGrants(ctx).list());
      case "revoke-grant": return json(await createGrants(ctx).revoke(String(args.grant)));
      case "preferences": return json(await createPreferences(ctx).list());
      case "forget": return json(await createPreferences(ctx).delete(String(args.preference)));
      default: throw new CallError("not_found", `settings.${name} not found`);
    }
  },
};

/** `schedules`: what is arranged for later (reminders, wakes, module schedules), for entry modules (v2-9). */
const schedules: SystemModule = {
  name: "schedules",
  tools: [
    tool("list", "Schedules, soonest first.", {}, [], { idempotent: true }),
    tool("update", "Pause, resume or cancel a schedule.", { schedule: text(), status: { type: "string", enum: ["active", "paused", "cancelled"] } }, ["schedule", "status"], { idempotent: true }),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    entry(caller);
    if (name === "list") return json(await createSchedules(ports, workspaceId).list());
    if (name === "update") return json(await createSchedules(ports, workspaceId).update(String(args.schedule), { status: args.status }));
    throw new CallError("not_found", `schedules.${name} not found`);
  },
};

/** `ai` (v2-10): the model and the Provider for modules, as routed calls. */
const ai: SystemModule = {
  name: "ai",
  unrecorded: ["complete"],
  tools: [
    tool("complete", "One completion from the model tier the manifest declares (`model`), within its limits and the owner's moduleModel; the text is untrusted data.",
      { system: text(), prompt: text(), maxOutputTokens: { type: "number" } }, ["prompt", "maxOutputTokens"]),
    tool("wake", "Start the Provider in a fresh session with this module's output as untrusted data (call async with a key derived from the event).", { prompt: text() }, ["prompt"]),
  ],
  async handle({ ports, workspaceId, caller, run }, name, args) {
    const module = entry(caller), manifest = await callerManifest(ports.db, module);
    if (!manifest) throw new CallError("forbidden", "Caller manifest not found");
    if (name === "complete") {
      const prompt = String(args.prompt), maxOutputTokens = Number(args.maxOutputTokens);
      if (!prompt.trim() || prompt.length > 200_000 || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 32_000 || (args.system !== undefined && String(args.system).length > 20_000)) throw new CallError("invalid", "Invalid completion request");
      return json(await completeForModule(ports, { workspaceId, moduleId: module.moduleId, hash: module.hash, manifest, ...run }, { prompt, maxOutputTokens, ...(args.system !== undefined ? { system: String(args.system) } : {}) }));
    }
    if (name === "wake") {
      const prompt = String(args.prompt).trim();
      if (!prompt || prompt.length > 4000) throw new CallError("invalid", "Invalid wake prompt");
      const now = ports.now();
      return json(await ports.db.$transaction(async tx => {
        const session = await createRunSession(tx, workspaceId, "module", now, { moduleId: module.moduleId });
        await createRuns(ports, workspaceId).enqueue({ sessionId: session.id, lane: "background", trigger: "source", label: manifest.name, prompt: `Module ${manifest.name} output (untrusted data):\n${prompt}` }, tx);
        return { sessionId: session.id };
      }));
    }
    throw new CallError("not_found", `ai.${name} not found`);
  },
};

/** `secrets` (v2-10): a credential the calling entry module lists in `secrets`; never logged or stored in call records. */
const secrets: SystemModule = {
  name: "secrets",
  unrecorded: ["get"],
  tools: [tool("get", "A credential this entry module lists in its manifest's secrets.", { name: text() }, ["name"], { idempotent: true })],
  async handle({ ports, caller }, name, args) {
    const module = entry(caller), manifest = await callerManifest(ports.db, module), secret = String(args.name);
    if (name !== "get") throw new CallError("not_found", `secrets.${name} not found`);
    if (!manifest || !isEntryModule(manifest) || !manifest.secrets.includes(secret)) throw new CallError("forbidden", "Secret not declared");
    const value = await ports.secrets?.(secret).catch(() => null);
    if (!value) throw new CallError("unavailable", "Secret not configured");
    return { value };
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
  registerSystemModule(settings);
  registerSystemModule(schedules);
  registerSystemModule(ai);
  registerSystemModule(secrets);
}

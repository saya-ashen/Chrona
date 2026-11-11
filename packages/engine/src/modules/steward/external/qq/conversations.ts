import { lstat, mkdir, open, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createAgentConversations } from "./agent-conversations";
import type { QqBinding, QqChatPort, QqReplyItem } from "./bot";
type Call = (target: string, args: Record<string, unknown>, options?: { key?: string }) => Promise<unknown>;

type Route = { owner: string; workspace: string };
type State = { version: 1; routes: Record<string, Route>; deliveries: Partial<Record<string, "pending" | "accepted" | "withheld">> };
function parseDeliveryJournal(text: string): State {
  const state = JSON.parse(text) as { version?: number; routes?: Record<string, Route | null> | null; deliveries?: Record<string, string> | null } | null;
  if (state?.version !== 1 || !state.routes || !state.deliveries || typeof state.routes !== "object" || typeof state.deliveries !== "object" || Array.isArray(state.routes) || Array.isArray(state.deliveries)
    || Object.values(state.routes).some(route => !route || typeof route.owner !== "string" || typeof route.workspace !== "string")
    || Object.values(state.deliveries).some(value => !["pending", "accepted", "withheld"].includes(value))) throw new Error("Invalid QQ conversation delivery journal");
  return state as State;
}
async function readAttachment(contentDir: string, ref: string) {
  if (!/^qq\/attachments\/[a-f0-9]{64}-[\p{L}\p{N}_.-]{1,120}$/u.test(ref)) throw new Error("Invalid QQ attachment reference");
  const root = await realpath(contentDir), directory = join(contentDir, "attachments"), path = join(contentDir, ref.slice(3));
  if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== join(root, "attachments")) throw new Error("Invalid QQ attachment directory");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024 || await realpath(path) !== join(root, ref.slice(3))) throw new Error("Invalid QQ attachment file");
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== stat.size) throw new Error("QQ attachment changed while reading");
    return bytes.subarray(0, size);
  } finally { await handle.close(); }
}
export function createQqConversations(options: { dataDir: string; contentDir: string; call: Call; binding: () => Promise<QqBinding | null>; deliver: (item: QqReplyItem) => Promise<unknown> }) {
  const app = createAgentConversations({ source: "qq", dataDir: options.dataDir, call: (target, args = {}, callOptions) => options.call(target, args, callOptions), reply: () => {} });
  const directory = join(options.dataDir, "conversation-delivery"), path = join(directory, "state.json");
  let queue = Promise.resolve<unknown>(undefined);
  function serial<T>(work: () => Promise<T>) { const next = queue.then(work); queue = next.catch(() => {}); return next; }
  async function load(): Promise<State> {
    let text: string;
    try { text = await readFile(path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, routes: {}, deliveries: {} }; throw error; }
    return parseDeliveryJournal(text);
  }
  async function save(state: State) {
    await mkdir(directory, { recursive: true }); await writeFile(`${path}.next`, JSON.stringify(state), { mode: 0o600 }); await rename(`${path}.next`, path);
  }
  const key = (owner: string) => `qq:dm:${createHash("sha256").update(owner).digest("hex")}`;
  async function bound() { const binding = await options.binding(); if (!binding) throw new Error("QQ owner is not bound"); return binding; }
  return {
    app,
    send: (input: Omit<Parameters<QqChatPort["send"]>[0], "attachments"> & { attachments?: unknown[] }) => serial(async () => {
      const binding = await bound(), state = await load(), route = { owner: binding.openid, workspace: input.workspaceId };
      const prior = Object.hasOwn(state.routes, input.externalId) ? state.routes[input.externalId] : undefined;
      if (prior && (prior.owner !== route.owner || prior.workspace !== route.workspace)) throw new Error("QQ message delivery owner changed");
      if (!prior && Object.keys(state.routes).length >= 100000) throw new Error("QQ delivery journal is full");
      Object.defineProperty(state.routes, input.externalId, { value: route, enumerable: true, configurable: true, writable: true }); await save(state);
      await app.send({ key: key(binding.openid), text: input.text || "请查看附件。", requestKey: input.externalId, attachments: input.attachments, quotedExternalId: input.quotedExternalId });
      return {};
    }),
    newSession: () => serial(async () => { const binding = await bound(); const session = (await app.list()).find(session => session.key === key(binding.openid) && session.status === "active"); if (session) await app.update(session.id, { status: "ended" }); return { ok: true }; }),
    attach: async (file: { name: string; mime: string; bytes: Uint8Array }) => {
      if (file.bytes.byteLength > 20 * 1024 * 1024) throw new Error("Attachment exceeds 20 MiB");
      const digest = createHash("sha256").update(file.bytes).digest("hex"), name = file.name.replace(/[^\p{L}\p{N}_.-]/gu, "_").slice(-120) || "attachment";
      const relative = `attachments/${digest}-${name}`;
      await mkdir(join(options.contentDir, "attachments"), { recursive: true });
      const target = join(options.contentDir, relative);
      try { await writeFile(target, file.bytes, { mode: 0o600, flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || createHash("sha256").update(await readFile(target)).digest("hex") !== digest) throw error; }
      return { name: file.name.slice(0, 200), ref: `qq/${relative}`, mime: file.mime, size: file.bytes.byteLength };
    },
    file: async (messageId: string, ref: string) => {
      const attachment = await app.attachment(messageId, ref);
      if (!attachment) throw new Error("Attachment does not belong to this QQ message");
      const bytes = await readAttachment(options.contentDir, ref), file = attachment as { mime?: unknown };
      return { base64: bytes.toString("base64"), mime: typeof file.mime === "string" ? file.mime : "application/octet-stream" };
    },
    externalId: app.externalId,
    record: async (text: string, externalId: string) => { const binding = await bound(); return app.record(key(binding.openid), text.slice(0, 8000), externalId); },
    poll: async () => {
      const items = await serial(async () => {
      await app.poll(); const state = await load(), items: QqReplyItem[] = [];
      for (const session of await app.list()) for (const message of await app.messages(session.id)) {
        if (message.direction !== "out" || !message.inReplyTo || state.deliveries[message.id]) continue;
        const route = Object.hasOwn(state.routes, message.inReplyTo) ? state.routes[message.inReplyTo] : undefined, binding = await options.binding();
        // A restart or replacement owner never authorizes delivery of someone else's pending result.
        if (!route || !binding || route.owner !== binding.openid || route.workspace !== binding.workspaceId) { state.deliveries[message.id] = "withheld"; await save(state); continue; }
        state.deliveries[message.id] = "pending"; await save(state);
        items.push({ owner: route.owner, workspace: route.workspace, sessionId: session.id, messageId: message.id, text: message.text, inReplyTo: message.inReplyTo, attachments: [] });
      }
      return items;
      });
      for (const item of items) {
        // Delivery may call back into this entry. Keep its handler queue free.
        await options.deliver(item);
        await serial(async () => { const state = await load(); state.deliveries[item.messageId] = "accepted"; await save(state); });
      }
    },
  };
}
export type QqConversations = ReturnType<typeof createQqConversations>;

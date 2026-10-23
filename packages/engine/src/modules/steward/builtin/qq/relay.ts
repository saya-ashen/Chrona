import type { ApprovalDecision, QqBinding, QqChatPort, QqChatResult } from "./bot";
import type { QqAttachment } from "./official";

/** Everything the QQ module asks of Chrona, through the owner API (`chrona.owner`). */
export type Owner = (request: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; body?: unknown }) => Promise<{ status: number; body: unknown }>;
type Attachment = { name: string; ref: string | null; mime: string; size: number };
type Message = { id: string; sessionId: string; text: string; attachments: Attachment[] };
type Download = (attachment: QqAttachment) => Promise<{ name: string; mime: string; bytes: Uint8Array }>;
export const RESCUE_ONLY = "【Chrona】请在救援控制台处理这条审批（或使用 chrona admin）。";

async function call<T>(owner: Owner, request: Parameters<Owner>[0]): Promise<T> {
  const reply = await owner(request);
  if (reply.status >= 400) {
    const body = reply.body as { code?: string } | null;
    throw Object.assign(new Error(`Owner API ${request.method} ${request.path.split("?")[0]} failed (${reply.status})`), { status: reply.status, code: body?.code });
  }
  return reply.body as T;
}

/** Pages open in the web reader; other files download through the authenticated raw route. Never expose a local path. */
export function qqReplyText(message: Pick<Message, "text" | "attachments">, publicUrl: string | null, workspaceId: string, apps: { id: string; name: string }[] = []) {
  return [message.text, ...message.attachments.map(file => {
    const [name, ...parts] = file.ref?.split("/") ?? [], app = apps.find(app => app.name === name);
    return app && parts.length && publicUrl
      ? `${linkLabel(file.name)}：${fileLink(publicUrl.replace(/\/$/, ""), app.id, parts.join("/"), workspaceId)}`
      : `${file.name}（请在 Chrona 网页查看附件）`;
  })].join("\n\n");
}
/** People see page names, not file names: composed pages are "the page", Markdown pages drop their extension. */
function linkLabel(name: string) {
  if (/\.ui\.json$/i.test(name)) return "打开页面";
  if (/^readme\.md$/i.test(name)) return "总览";
  return name.replace(/\.md$/i, "");
}
function fileLink(origin: string, appId: string, path: string, workspaceId: string) {
  const app = encodeURIComponent(appId);
  return /\.(md|ui\.json)$/i.test(path)
    ? `${origin}/apps/${app}?${new URLSearchParams({ path })}`
    : `${origin}/api/steward/apps/${app}/raw?${new URLSearchParams({ workspaceId, path })}`;
}
const isReplyImage = (file: Attachment | undefined) => Boolean(file?.ref && ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mime) && file.size <= 5 * 1024 * 1024);

export function createRelay({ owner, publicUrl, download, pollMs = 2000 }: { owner: Owner; publicUrl: string | null; download: Download; pollMs?: number }) {
  // Reply bodies by message id, for image uploads; and replies already relayed (a run's late replies are polled).
  const sent = new Map<string, Message>(), claimed = new Set<string>();
  const apps = async () => (await call<{ items: { id: string; name: string }[] }>(owner, { method: "GET", path: "/apps" })).items;
  const item = (message: Message, workspaceId: string, list: { id: string; name: string }[]) => {
    sent.set(message.id, message); claimed.add(message.id);
    return { messageId: message.id, sessionId: message.sessionId, reply: qqReplyText(message, publicUrl, workspaceId, list) };
  };
  async function* later(runId: string, workspaceId: string) {
    for (let done = false; !done;) {
      const replies = await call<{ done: boolean; items: Message[] }>(owner, { method: "GET", path: `/chat/runs/${encodeURIComponent(runId)}` });
      done = replies.done;
      const fresh = replies.items.filter(message => !claimed.has(message.id));
      if (fresh.length) { const list = await apps(); for (const message of fresh) yield item(message, workspaceId, list); }
      if (!done) await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  }
  const chat: QqChatPort["handleMessage"] = async input => {
    // QQ keeps one conversation; `/new` ends it and the next message starts a fresh one.
    if (input.text.trim() === "/new" && !input.attachments?.length) {
      await call(owner, { method: "POST", path: "/sessions/new", body: { key: "qq:dm" } });
      return { reply: "【Chrona】已开始新会话。" };
    }
    if ((input.attachments?.length ?? 0) > 10) throw new Error("Too many attachments");
    const attachments = [];
    for (const attachment of input.attachments ?? []) {
      const file = await download(attachment);
      attachments.push(await call<Attachment>(owner, { method: "POST", path: "/chat/attachments", body: { name: file.name, mime: file.mime, base64: Buffer.from(file.bytes).toString("base64") } }));
    }
    const result = await call<{ runId: string | null; sessionId: string; messages: Message[] }>(owner, { method: "POST", path: "/chat", body: {
      text: input.text, key: "qq:dm", channel: "chrona_qqbot", externalId: input.externalId,
      ...(input.quotedExternalId ? { quotedExternalId: `qq:out:${input.quotedExternalId}` } : {}), ...(attachments.length ? { attachments } : {}),
    } });
    const list = await apps();
    const replies = result.messages.map(message => item(message, input.workspaceId, list));
    return { reply: replies.map(reply => reply.reply).join("\n\n") || "处理尚未完成，请稍后在网页查看。", sessionId: result.sessionId, workspaceId: input.workspaceId, replies,
      ...(result.runId ? { later: later(result.runId, input.workspaceId) } : {}) } satisfies QqChatResult;
  };
  return {
    chat, later,
    /** The bound owner's decision on one open approval, addressed by an id prefix. */
    async resolveApproval(_binding: QqBinding, decision: ApprovalDecision) {
      const open = (await call<{ items: { id: string; title: string; rescueOnly: boolean }[] }>(owner, { method: "GET", path: "/approvals?status=open" })).items;
      const matches = open.filter(approval => approval.id.startsWith(decision.ref));
      if (matches.length !== 1) return matches.length ? "【Chrona】编号对应多条审批，请多写几位。" : "【Chrona】没有找到这条待批准事项，可能已经处理过了。";
      const approval = matches[0]!;
      if (approval.rescueOnly) return RESCUE_ONLY;
      const reply = await owner({ method: "POST", path: `/approvals/${encodeURIComponent(approval.id)}/resolve`, body: { decision: decision.decision, scope: decision.scope } });
      if (reply.status === 403) return RESCUE_ONLY;
      if (reply.status >= 400) throw new Error(`Approval resolve failed (${reply.status})`);
      return `【Chrona】已${decision.decision === "deny" ? "拒绝" : decision.scope === "always" ? "批准（始终允许）" : "批准"}：${approval.title}`;
    },
    /** The first image of a reply, as bytes for a QQ rich-media upload. */
    async replyImage(messageId: string) {
      const image = sent.get(messageId)?.attachments.find(isReplyImage);
      if (!image?.ref) return null;
      const [name, ...parts] = image.ref.split("/"), app = (await apps()).find(app => app.name === name);
      if (!app) return null;
      const raw = await call<{ base64?: string }>(owner, { method: "GET", path: `/apps/${encodeURIComponent(app.id)}/raw?${new URLSearchParams({ path: parts.join("/") })}` });
      return raw.base64 ? Buffer.from(raw.base64, "base64") : null;
    },
    setExternalId: (messageId: string, externalId: string) => call(owner, { method: "PATCH", path: `/messages/${encodeURIComponent(messageId)}`, body: { externalId } }),
    /** The normal budget may fold this into a digest; never bypass quiet hours/caps. Pinned to its sender. */
    enqueueFinal: (key: string, text: string, recipient: string, sessionId?: string | null) => call(owner, { method: "POST", path: "/notifications", body: { title: "Chrona", body: text, dedupeKey: `response:qq-final:${key}`, recipient, ...(sessionId ? { sessionId } : {}) } }),
    /** A notification QQ accepted joins the QQ session, so quoting it works. */
    recordDelivered: (text: string, externalId: string) => call(owner, { method: "POST", path: "/messages", body: { key: "qq:dm", channel: "chrona_qqbot", text: text.slice(0, 8000), externalId } }),
  };
}

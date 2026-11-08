import type { ApprovalDecision, QqBinding, QqChatPort, QqReplyItem } from "./bot";
import type { QqAttachment } from "./official";
import type { QqConversations } from "./conversations";

/** Everything the QQ module asks of Chrona, as routed calls (`chrona.call`): `chat.*`, `approvals.*`, `notify.send`. */
export type Call = (target: string, args: Record<string, unknown>) => Promise<unknown>;
type Attachment = { name: string; ref: string | null; mime: string; size: number };
type Download = (attachment: QqAttachment) => Promise<{ name: string; mime: string; bytes: Uint8Array }>;

/** Files stay with the conversation: the link opens it on the web page, which downloads them with the user's key. Never expose a local path. */
export function qqReplyText(message: { text: string; attachments: Attachment[] }, publicUrl: string | null, sessionId: string | null) {
  const link = publicUrl && sessionId ? `${publicUrl.replace(/\/$/, "")}/sessions/${encodeURIComponent(sessionId)}` : null;
  return [message.text, ...message.attachments.map(file => link && file.ref ? `${file.name}：${link}` : `${file.name}（请在 Chrona 网页查看附件）`)].join("\n\n");
}
const isReplyImage = (file: Attachment | undefined) => Boolean(file?.ref && ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mime) && file.size <= 5 * 1024 * 1024);

/** `call` is sync (resolves to the tool's result); `notify` is an async call to notify.send. */
/** What the QQ module asks notify.send for: a final reply to the bound owner. */
export type FinalNotice = { key: string; level: "now"; title: string; body: string; recipient: string; responds: true; session?: string };
export function createRelay({ call, notify, publicUrl, download, conversations }: { conversations?: Pick<QqConversations, "send" | "attach" | "newSession" | "file" | "externalId" | "record">; call: Call; notify: (args: FinalNotice) => Promise<unknown>; publicUrl: string | null; download: Download }) {
  function app() { if (!conversations) throw new Error("QQ conversation application is unavailable"); return conversations; }
  const send: QqChatPort["send"] = async input => {
    // QQ keeps one conversation; `/new` ends it and the next message starts a fresh one.
    if (input.text.trim() === "/new" && !input.attachments?.length) {
      await app().newSession();
      return { reply: "【Chrona】已开始新会话。" };
    }
    if ((input.attachments?.length ?? 0) > 10) throw new Error("Too many attachments");
    const attachments = [];
    for (const attachment of input.attachments ?? []) {
      const file = await download(attachment);
      attachments.push(await app().attach(file));
    }
    await app().send({ ...input, attachments, ...(input.quotedExternalId ? { quotedExternalId: `qq:out:${input.quotedExternalId}` } : {}) });
    return {};
  };
  return {
    send,
    /** The text QQ shows for a pushed reply: the reply plus links to its files. */
    replyText: (item: Pick<QqReplyItem, "text" | "attachments" | "sessionId">) => qqReplyText(item, publicUrl, item.sessionId),
    /** The bound owner's decision on one open approval, addressed by an id prefix. */
    async resolveApproval(_binding: QqBinding, decision: ApprovalDecision) {
      const open = await call("approvals.list", { status: "open" }) as { id: string; title: string }[];
      const matches = open.filter(approval => approval.id.startsWith(decision.ref));
      if (matches.length !== 1) return matches.length ? "【Chrona】编号对应多条审批，请多写几位。" : "【Chrona】没有找到这条待批准事项，可能已经处理过了。";
      const approval = matches[0]!;
      await call("approvals.resolve", { approval: approval.id, decision: decision.decision, scope: decision.scope });
      return `【Chrona】已${decision.decision === "deny" ? "拒绝" : decision.scope === "always" ? "批准（始终允许）" : "批准"}：${approval.title}`;
    },
    /** The first image of a reply, as bytes for a QQ rich-media upload. */
    async replyImage(item: Pick<QqReplyItem, "messageId" | "attachments">) {
      const image = item.attachments.find(isReplyImage);
      if (!image?.ref) return null;
      const file = await app().file(item.messageId, image.ref) as { base64?: string };
      return file.base64 ? Buffer.from(file.base64, "base64") : null;
    },
    setExternalId: (messageId: string, externalId: string) => app().externalId(messageId, externalId),
    /** The normal budget may fold this into a digest; never bypass quiet hours/caps. Pinned to its sender. */
    enqueueFinal: (key: string, text: string, recipient: string, sessionId?: string | null) => notify({ key: `response:qq-final:${key}`, level: "now", title: "Chrona", body: text.slice(0, 4000), recipient, responds: true, ...(sessionId ? { session: sessionId } : {}) }),
    /** A notification QQ accepted joins the QQ conversation, so quoting it works. */
    recordDelivered: (text: string, externalId: string) => app().record(text.slice(0, 8000), externalId),
  };
}

import { createHash } from "node:crypto";
import type { StewardService, StewardChatTransport } from "@chrona/engine";
import type { PrismaClient } from "@chrona/db";
import { attachmentSchema } from "@chrona/contracts/steward";
import { createChronaQqDelivery, createQqBotHandler, createQqBotState, parseApprovalDecision, qqBotConfig, DEDICATED_PLATFORM, type ApprovalDecision, type QqBinding } from "../../../packages/integrations/src/steward/qq-official-bot";
import { ackQqInteraction, uploadQqImage, downloadQqAttachment, createQqGateway, createQqTokenSource, readProtectedSecret, sendQqC2c, type QqInteraction, type QqLog, type QqC2cMessage } from "../../../packages/integrations/src/steward/qq-official";

/** Pages open in the web reader; other files download through the authenticated raw route. Never expose a local path. */
export function qqReplyText(message: Pick<import("@chrona/contracts/steward").Message, "text" | "attachments">, publicUrl: string | null, workspaceId: string, apps: { id: string; name: string }[] = []) {
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

function isReplyImage(file: import("@chrona/contracts/steward").Attachment | undefined) {
  return file?.ref && ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mime) && file.size <= 5 * 1024 * 1024;
}

/** The bound owner's decision on one open approval, addressed by an id prefix. */
export function approvalResolver(service: StewardService) {
  return async (binding: QqBinding, decision: ApprovalDecision) => {
    const api = service.forWorkspace(binding.workspaceId), matches = (await api.approvals.list("open")).filter(a => a.id.startsWith(decision.ref));
    if (matches.length !== 1) return matches.length ? "【Chrona】编号对应多条审批，请多写几位。" : "【Chrona】没有找到这条待批准事项，可能已经处理过了。";
    const approval = matches[0]!, scope = decision.scope;
    if (approval.rescueOnly) return "【Chrona】请在救援控制台处理这条审批（或使用 chrona admin）。";
    await api.approvals.resolve(approval.id, { decision: decision.decision, scope }, "qq");
    return `【Chrona】已${decision.decision === "deny" ? "拒绝" : scope === "always" ? "批准（始终允许）" : "批准"}：${approval.title}`;
  };
}

/** Replies a run sends after its first batch reached QQ; ends when the run does. Each message is claimed once per process. */
const claimedReplies = new Set<string>();
export async function* lateReplies(db: PrismaClient, workspaceId: string, runId: string, { seen, publicUrl, pollMs = 2000 }: { seen: Set<string>; publicUrl: string | null; pollMs?: number }) {
  for (let done = false; !done;) {
    done = (await db.run.findFirst({ where: { id: runId, workspaceId }, select: { status: true } }))?.status !== "running";
    const ids = (await db.audit.findMany({ where: { workspaceId, kind: "run_reply", subjectId: runId }, orderBy: { createdAt: "asc" } }))
      .map(a => (a.details as { messageId?: string } | null)?.messageId).filter((id): id is string => !!id && !seen.has(id) && !claimedReplies.has(id));
    for (const message of await db.message.findMany({ where: { id: { in: ids }, workspaceId, externalId: null }, orderBy: [{ at: "asc" }, { id: "asc" }] })) {
      seen.add(message.id); claimedReplies.add(message.id);
      yield { messageId: message.id, sessionId: message.sessionId, reply: qqReplyText(toReplyView(message), publicUrl, workspaceId, await db.module.findMany({ where: { workspaceId }, select: { id: true, name: true } })) };
    }
    if (!done) await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
const toReplyView = (row: { text: string; attachments: unknown }) => ({ text: row.text, attachments: Array.isArray(row.attachments) ? row.attachments.flatMap(a => attachmentSchema.safeParse(a).data ?? []) : [] });

/** A button click is the owner's decision only when the bound owner clicked it. */
async function approvalClick(interaction: QqInteraction, deps: { ack: () => Promise<void>; binding: () => Promise<QqBinding | null>; resolve?: ReturnType<typeof approvalResolver>; log: QqLog }) {
  await deps.ack().catch(() => deps.log("qq.interaction_ack_failed"));
  const binding = await deps.binding(), decision = parseApprovalDecision({ button: interaction.data });
  deps.log("qq.approval_click", { result: decision && deps.resolve && binding?.openid === interaction.openid ? await deps.resolve(binding, decision).catch(() => "failed") : "ignored" });
}

/** Injectable transport boundary; tests never read secrets or open a gateway. */
export function createStewardQqBot({ db, publicUrl, now = () => new Date(), env = process.env, transport }: {
  db: PrismaClient; publicUrl: string | null; now?: () => Date; env?: Record<string, string | undefined>;
  transport?: {
    send: typeof sendQqC2c;
    gateway: typeof createQqGateway;
    download?: typeof downloadQqAttachment;
    upload?: typeof uploadQqImage;
    ack?: typeof ackQqInteraction;
  };
}): StewardChatTransport | null {
  const config = qqBotConfig(env);
  if (!config?.secretFile) return null;
  const { appId, stateDir, secretFile } = config;
  const log: QqLog = (event, fields = {}) => console.info(JSON.stringify({ component: "qq-bot", appId, event, ...fields }));
  const tokens = createQqTokenSource({ appId, readSecret: () => readProtectedSecret(secretFile), log });
  const state = createQqBotState(stateDir, appId);
  let recipients = new Set<string>();
  const delivery = createChronaQqDelivery({ tokens, publicUrl, allowedRecipients: () => recipients, send: transport?.send });
  let handler: ReturnType<typeof createQqBotHandler> | undefined, resolveApproval: ((binding: QqBinding, decision: ApprovalDecision) => Promise<string>) | undefined;
  const gateway = (transport?.gateway ?? createQqGateway)({ appId, tokens, log, onMessage: (message: QqC2cMessage) => { void handler?.onMessage(message).then(writeStatus); }, onInteraction: interaction => { void approvalClick(interaction, { ack: () => (transport?.ack ?? ackQqInteraction)({ tokens, id: interaction.id }), binding: refreshBinding, resolve: resolveApproval, log }); } });
  async function refreshBinding() {
    const binding = await state.binding();
    recipients = new Set(binding ? [`${DEDICATED_PLATFORM}:${binding.openid}`] : []);
    return binding;
  }
  async function writeStatus() {
    try {
      const binding = await refreshBinding();
      await state.writeStatus({ updatedAt: now().toISOString(), gateway: gateway.status(), token: tokens.status(), bound: Boolean(binding), boundAt: binding?.boundAt ?? null, ownerHash: binding ? createHash("sha256").update(`${DEDICATED_PLATFORM}:${binding.openid}`).digest("hex").slice(0, 12) : null, challengePending: await state.challengePending(now()) });
    } catch { log("qq.status_write_failed"); }
  }
  async function uploadReplyImage(service: StewardService, openid: string, messageId: string, workspaceId: string) {
    const row = await db.message.findFirst({ where: { id: messageId, workspaceId, channel: "chrona_qqbot", direction: "out" } });
    const image = Array.isArray(row?.attachments) ? row.attachments.map(a => attachmentSchema.safeParse(a).data).find(isReplyImage) : null;
    if (image?.ref) {
      try {
        const [name, ...parts] = image.ref.split("/"), api = service.forWorkspace(workspaceId);
        const app = (await api.modules.list()).find(app => app.name === name);
        if (!app) return undefined;
        const { bytes } = await api.content.raw(app.id, parts.join("/"));
        return await (transport?.upload ?? uploadQqImage)({ tokens, openid, bytes }) ?? undefined;
      } catch { /* Unsupported media remains available through the authenticated web link. */ }
    }
    return undefined;
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    delivery: { channel: delivery.channel, async send(input) {
      // Conversation replies are collected by handleMessage and sent passively below.
      // Only notification outbox messages may use proactive delivery.
      if (input.idempotencyKey.startsWith("reply:")) return { outcome: "accepted", receiptRef: null };
      const binding = await refreshBinding();
      const result = await delivery.send(input);
      if (binding && result.outcome === "accepted" && result.receiptRef) {
        try {
          const externalId = `qq:out:${result.receiptRef.slice(`${DEDICATED_PLATFORM}:`.length)}`;
          const session = await db.session.findFirst({ where: { workspaceId: binding.workspaceId, key: "qq:dm", status: "active" } });
          if (session) await db.message.upsert({ where: { workspaceId_externalId: { workspaceId: binding.workspaceId, externalId } }, update: {}, create: { workspaceId: binding.workspaceId, externalId, sessionId: session.id, channel: "chrona_qqbot", direction: "out", text: [input.title, input.body].filter(Boolean).join("\n\n").slice(0, 8000), at: now() } });
        } catch { log("qq.receipt_store_failed"); } // Never retry a send that QQ accepted.
      }
      return result;
    } },
    bound: async () => Boolean(await refreshBinding()),
    async start(service: StewardService, wake: () => void) {
      if (handler) return;
      resolveApproval = approvalResolver(service);
      handler = createQqBotHandler({ state, now, log, resolveApproval,
        chat: { async handleMessage(input) {
          try {
            const { attachments: remote = [], quotedExternalId, ...chatInput } = input;
            if (remote.length > 10) throw new Error("Too many attachments");
            const quoted = quotedExternalId ? await db.message.findFirst({ where: { workspaceId: input.workspaceId, channel: "chrona_qqbot", direction: "out", externalId: `qq:out:${quotedExternalId}` } }) : null;
            const quote = quoted ? { quotedMessageId: quoted.id } : {};
            const files = [];
            for (const attachment of remote) files.push(await (transport?.download ?? downloadQqAttachment)(attachment));
            const intake = files.length ? await service.chat.intakeAttachments({ ...chatInput, ...quote }, files) : {};
            const result = await service.chat.handleMessage({ ...chatInput, ...quote, ...intake, key: "qq:dm" });
            const apps = await service.forWorkspace(input.workspaceId).modules.list();
            const replies = result.messages.map(message => ({ messageId: message.id, sessionId: message.sessionId, reply: qqReplyText(message, publicUrl, input.workspaceId, apps) }));
            return { reply: replies.map(m => m.reply).join("\n\n") || "处理尚未完成，请稍后在网页查看。", sessionId: result.sessionId, workspaceId: input.workspaceId, replies, ...(result.runId ? { later: lateReplies(db, input.workspaceId, result.runId, { seen: new Set(replies.map(r => r.messageId)), publicUrl }) } : {}) };
          } finally { wake(); }
        } },
        reply: async (openid, messageId, text, msgSeq, message) => {
          const mediaFileInfo = message?.messageId && message.workspaceId
            ? await uploadReplyImage(service, openid, message.messageId, message.workspaceId) : undefined;
          const result = await (transport?.send ?? sendQqC2c)({ tokens, openid, content: text, replyTo: messageId, msgSeq, ...(mediaFileInfo ? { mediaFileInfo } : {}) });
          if (result.outcome !== "accepted") throw new Error("Passive reply not accepted");
          if (message?.messageId && message.workspaceId) await db.message.updateMany({ where: { id: message.messageId, workspaceId: message.workspaceId, direction: "out", channel: "chrona_qqbot" }, data: { externalId: `qq:out:${result.messageId}` } });
        },
        async enqueueFinal(binding, messageId, text, sessionId) {
          // The normal budget may fold this into a digest; never bypass quiet hours/caps.
          await db.$transaction(async tx => {
            const row = await service.forWorkspace(binding.workspaceId).notifications.enqueueNotification(tx, { workspaceId: binding.workspaceId, level: "now", title: "Chrona", body: text, dedupeKey: `qq-final:${messageId}`, ...(sessionId ? { sessionId } : {}) });
            // Pin this reply to its sender. A replacement owner must not receive
            // an old final reply; the adapter rejects recipients no longer bound.
            await tx.notification.update({ where: { id: row.id }, data: { recipient: `${DEDICATED_PLATFORM}:${binding.openid}` } });
          });
        },
        onBound: async () => { await writeStatus(); },
      });
      await refreshBinding();
      gateway.start();
      timer = setInterval(() => void writeStatus(), 30_000);
      await writeStatus();
    },
    async stop() { clearInterval(timer); await gateway.stop(); await handler?.drain(); await writeStatus(); },
  };
}

import { spawn } from "node:child_process";
import type { DeliveryAdapter, DeliveryMessage, DeliveryOutcome } from "@chrona/contracts/steward";

const recipientPattern = /^qqbot:[A-Za-z0-9_-]{1,128}$/;
function clean(value: string | null | undefined, cap = 200): string {
  let text = (value ?? "").replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim();
  while (/\[\[|\]\]/.test(text)) text = text.replace(/\[\[|\]\]/g, "");
  return text.replace(/MEDIA:/gi, "MEDIA：").replace(/\s+/g, " ").trim().slice(0, cap).trim();
}
function httpUrl(value: string | null | undefined): string | null { try { const url = new URL(value ?? ""); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } }
/** Plain-text notification for a QQ chat; `replyLine` renders the transport's reply instruction. */
export function renderChatNotification(message: DeliveryMessage, publicUrl: string | null | undefined, replyLine: (ref: string) => string): string {
  const lines: string[] = [];
  const add = (label: string, value: string | null | undefined, cap: number) => { const text = clean(value, cap); if (text) lines.push(label + text); };
  const title = clean(message.title, 120), detail = clean(message.body, 500);
  const head = title || detail;
  if (head) lines.push(head.startsWith("【Chrona】") ? head : `【Chrona】${head}`);
  if (title && detail && !title.includes(detail) && !detail.includes(title)) lines.push(detail);
  add("为何重要：", message.whyItMatters, 300); add("下一步：", message.nextStep, 300);
  // Reserve room for navigation and the reply instruction even with maximal prose.
  add("来源：", httpUrl(message.link), 70);
  const origin = httpUrl(publicUrl);
  if (origin && message.appPath?.startsWith("/")) add("详情：", `${new URL(origin).origin}/zh${message.appPath}`, 90);
  if (clean(message.replyRef)) lines.push(replyLine(clean(message.replyRef, 16)));
  return lines.join("\n").slice(0, 1500);
}

/** One host-owned send, never retried here: QQ delivery has no idempotency guarantee. */
export function createHermesQqDelivery(options: { allowedRecipients: string[]; publicUrl?: string | null; command?: string; timeoutMs?: number }): DeliveryAdapter & { idempotent: false } {
  const allowed = new Set(options.allowedRecipients);
  return { channel: "hermes_qqbot", idempotent: false, async send(message) {
    const recipient = message.recipient;
    if (!recipient || !recipientPattern.test(recipient) || !allowed.has(recipient)) return { outcome: "rejected", retryable: false, error: "Recipient is not authorized" };
    return new Promise<DeliveryOutcome>((resolve) => {
      let settled = false; let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: DeliveryOutcome) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
      try {
        const child = spawn(options.command ?? "hermes", ["send", "--to", recipient, "--json", "--file", "-"], { stdio: ["pipe", "pipe", "pipe"], shell: false });
        let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let overflow = false;
        child.stdout.on("data", (data: Buffer) => { if (stdout.length + data.length > 65536) overflow = true; stdout = Buffer.concat([stdout, data.subarray(0, 65536 - stdout.length)]); });
        child.stderr.on("data", (data: Buffer) => { stderr = Buffer.concat([stderr, data.subarray(0, 65536 - stderr.length)]); });
        child.stdin.on("error", () => { /* EPIPE: exit status determines delivery certainty. */ });
        child.on("error", () => finish({ outcome: "rejected", retryable: true, error: "Hermes send unavailable" }));
        child.on("close", (code) => {
          let result: { success?: unknown; message_id?: unknown; error?: unknown } | null = null;
          try { if (!overflow) result = JSON.parse(stdout.toString()); } catch { /* Unknown host output is not proof of rejection. */ }
          if (code === 0 && result?.success === true) finish({ outcome: "accepted", receiptRef: typeof result.message_id === "string" && result.message_id ? `qqbot:${result.message_id}` : null });
          else if (code === 0) finish({ outcome: "uncertain", error: "Hermes send returned an unknown result" });
          else if (code === 2) finish({ outcome: "rejected", retryable: false, error: "Hermes send is not configured" });
          else if (code === 1 && typeof result?.error === "string" && /^QQBot (send failed: (channel|c2c|group)=\d|token request failed|: QQ_APP_ID)/.test(result.error)) finish({ outcome: "rejected", retryable: true, error: "QQ rejected the message" });
          else finish({ outcome: "uncertain", error: "Hermes send failed; delivery outcome unknown" });
        });
        timer = setTimeout(() => { child.kill("SIGKILL"); finish({ outcome: "uncertain", error: "Hermes send timed out" }); }, options.timeoutMs ?? 30000);
        child.stdin.end(renderChatNotification(message, options.publicUrl, ref => `回复：/chrona ${ref} 收到｜暂后｜完成｜暂停（发送≠已读）`));
      } catch { finish({ outcome: "rejected", retryable: true, error: "Hermes send unavailable" }); }
    });
  } };
}

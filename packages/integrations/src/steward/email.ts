import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type { ConnectorAdapter, SourceItem } from "@chrona/contracts/steward";

type ImapClient = Pick<ImapFlow, "connect" | "logout" | "close" | "mailboxOpen" | "search" | "fetchOne">;
type SmtpClient = Pick<ReturnType<typeof nodemailer.createTransport>, "verify" | "sendMail" | "close">;
export type EmailDependencies = {
  imap?: (options: ConstructorParameters<typeof ImapFlow>[0]) => ImapClient;
  smtp?: (options: Parameters<typeof nodemailer.createTransport>[0]) => SmtpClient;
  now?: () => Date; timeoutMs?: number;
};
type MailPosition = { validity: string; uid: number };
function initialSince(settings: Record<string, unknown>, now: () => Date) {
  const days = Number(settings.sinceDays ?? 3);
  return new Date(now().getTime() - (Number.isFinite(days) ? Math.max(1, days) : 3) * 86400000);
}
async function mailItem(source: Buffer, externalId: string, now: () => Date): Promise<SourceItem> {
  const parsed = await simpleParser(source, { skipHtmlToText: false, skipTextToHtml: true });
  return { externalId, from: parsed.from?.text ?? "", subject: parsed.subject ?? "(no subject)", body: Buffer.from(parsed.text ?? "").subarray(0, 200 * 1024).toString("utf8"), receivedAt: (parsed.date ?? now()).toISOString(), url: null,
    attachments: parsed.attachments.filter(a => a.size <= 10 * 1024 * 1024).map(a => ({ name: a.filename ?? "attachment", mime: a.contentType, bytes: a.content })) };
}
/** Read-only UID intake. No logger, flags, move, delete or mark-read operations. */
export function createEmailConnector(deps: EmailDependencies = {}): ConnectorAdapter {
  const timeoutMs = deps.timeoutMs ?? 30000;
  const now = deps.now ?? (() => new Date());
  async function timed<T>(action: Promise<T>, close: () => void): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([action, new Promise<never>((_, reject) => { timer = setTimeout(() => { close(); reject(new Error("Mail operation timed out")); }, timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  function imap(settings: Record<string, unknown>, secret: Record<string, string> | null) {
    return (deps.imap ?? (options => new ImapFlow(options)))({ host: String(settings.imapHost ?? ""), port: Number(settings.imapPort ?? 993), secure: true, auth: { user: String(settings.address ?? ""), pass: secret?.password ?? "" }, logger: false, connectionTimeout: timeoutMs, greetingTimeout: timeoutMs, socketTimeout: timeoutMs });
  }
  function smtp(settings: Record<string, unknown>, secret: Record<string, string> | null) {
    const port = Number(settings.smtpPort ?? 465);
    return (deps.smtp ?? (options => nodemailer.createTransport(options)))({ host: String(settings.smtpHost ?? ""), port, secure: port === 465, requireTLS: true, auth: { user: String(settings.address ?? ""), pass: secret?.smtpPassword ?? secret?.password ?? "" }, connectionTimeout: timeoutMs, greetingTimeout: timeoutMs, socketTimeout: timeoutMs } as Parameters<typeof nodemailer.createTransport>[0]);
  }
  function sanitized(error: unknown): Error {
    const auth = (error as { authenticationFailed?: boolean; responseCode?: number }).authenticationFailed || (error as { responseCode?: number }).responseCode === 535;
    return Object.assign(new Error(auth ? "Mail authorization required" : "Mail operation failed"), { code: auth ? "AUTHENTICATION_FAILED" : "MAIL_FAILED" });
  }
  async function pollFolder(client: ImapClient, folder: string, position: MailPosition | undefined, since: Date) {
    const close = () => client.close();
    const mailbox = await timed(client.mailboxOpen(folder, { readOnly: true }), close);
    const validity = String(mailbox.uidValidity), previous = position?.validity === validity ? position.uid : 0;
    const found = await timed(client.search(previous ? { uid: `${previous + 1}:*` } : { since }, { uid: true }), close);
    const items: SourceItem[] = [];
    let uid = previous;
    for (const next of (found || []).filter(n => n > previous).sort((a, b) => a - b).slice(0, 50)) {
      const message = await timed(client.fetchOne(String(next), { source: true }, { uid: true }), close);
      if (!message || !message.source) continue;
      // Bound MIME parsing allocation before parsing (large messages are skipped).
      if (message.source.byteLength <= 25 * 1024 * 1024) items.push(await mailItem(message.source, `${folder}:${validity}:${next}`, now));
      uid = next;
    }
    return { items, position: { validity, uid } };
  }
  return {
    kind: "email", coverageNote: "Read-only IMAP UID polling; initial sync defaults to the last 3 days. Attachments and bodies are size limited. SMTP requires Chrona authorization.",
    async test(settings, secret) {
      const client = imap(settings, secret);
      try {
        await timed(client.connect(), () => client.close());
        if (settings.smtpHost) { const transport = smtp(settings, secret); try { await timed(transport.verify(), () => transport.close()); } finally { transport.close(); } }
        return { ok: true };
      } catch { return { ok: false, error: "Mail connection test failed" }; }
      finally { client.close(); }
    },
    async poll({ settings, secret, cursor }) {
      const client = imap(settings, secret);
      const positions: Record<string, MailPosition> = cursor ? JSON.parse(cursor) : {};
      const folders = Array.isArray(settings.folders) ? settings.folders.filter((v): v is string => typeof v === "string") : ["INBOX"];
      const items: SourceItem[] = [];
      try {
        await timed(client.connect(), () => client.close());
        for (const folder of folders) {
          const previous = Object.hasOwn(positions, folder) ? positions[folder] : undefined;
          const result = await pollFolder(client, folder, previous, initialSince(settings, now));
          items.push(...result.items);
          Object.defineProperty(positions, folder, { value: result.position, enumerable: true, configurable: true, writable: true });
        }
        return { items, cursor: JSON.stringify(positions) };
      } catch (error) { throw sanitized(error); }
      finally { client.close(); }
    },
    async send({ settings, secret, to, subject, body, inReplyTo }) {
      if (!settings.smtpHost) return { ok: false, retryable: false, error: "SMTP is not configured" };
      const transport = smtp(settings, secret);
      try {
        const result = await timed(transport.sendMail({ from: String(settings.address ?? ""), to, subject, text: body, ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}) }), () => transport.close());
        return { ok: true, messageId: result.messageId ?? null };
      } catch { return { ok: false, retryable: false, error: "SMTP delivery failed or is uncertain; verify before retrying" }; }
      finally { transport.close(); }
    },
  };
}

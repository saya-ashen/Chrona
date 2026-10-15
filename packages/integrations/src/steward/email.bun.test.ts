import { expect, test } from "bun:test";
import { createEmailConnector, type EmailDependencies } from "./email";
test("injected IMAP reads without flag writes, parses HTML, advances UID cursor", async () => {
  let closed = 0;
  const adapter = createEmailConnector({ imap: (() => ({
    connect: async () => {}, close: () => { closed++; }, logout: async () => {},
    mailboxOpen: async (folder: string, options: unknown) => { expect(folder).toBe("INBOX"); expect(options).toEqual({ readOnly: true }); return { uidValidity: 12n }; },
    search: async () => [1],
    fetchOne: async (uid: string, query: unknown, options: unknown) => {
      expect(uid).toBe("1"); expect(query).toEqual({ source: true }); expect(options).toEqual({ uid: true });
      return { source: Buffer.from("From: sender@example.invalid\r\nTo: me@example.invalid\r\nSubject: Hello\r\nDate: Thu, 15 Oct 2026 04:00:00 +0000\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello <b>world</b></p>") };
    },
  })) as unknown as EmailDependencies["imap"] });
  const first = await adapter.poll({ settings: {}, secret: null, cursor: null });
  expect(first.items[0]).toMatchObject({ subject: "Hello", externalId: "INBOX:12:1" });
  expect(first.items[0]!.body).toContain("Hello world"); expect(first.items[0]!.body).not.toContain("<b>");
  expect((await adapter.poll({ settings: {}, secret: null, cursor: first.cursor })).items).toEqual([]);
  expect(closed).toBe(2);
});
test("SMTP uses configured sender and reply threading, always closes", async () => {
  let closed = false;
  const adapter = createEmailConnector({ smtp: (() => ({ verify: async () => true, close: () => { closed = true; }, sendMail: async (draft: unknown) => {
    expect(draft).toMatchObject({ from: "me@example.invalid", text: "draft", inReplyTo: "<original>", references: "<original>" });
    return { messageId: "<sent>" };
  } })) as EmailDependencies["smtp"] });
  expect(await adapter.send!({ settings: { smtpHost: "fake", address: "me@example.invalid" }, secret: null, to: ["you@example.invalid"], subject: "Hi", body: "draft", inReplyTo: "<original>" })).toEqual({ ok: true, messageId: "<sent>" });
  expect(closed).toBe(true);
});

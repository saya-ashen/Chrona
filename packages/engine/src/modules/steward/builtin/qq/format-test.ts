import { strict as assert } from "node:assert";
import { sendQqC2c, qqButtons, type QqTokenSource } from "./official";
import { createChronaQqDelivery, escapeQqTitle, markdownAppLink, type DeliveryMessage } from "./bot";

let gets = 0, invalidations = 0;
const tokens = { get: async () => { gets++; return "offline-token"; }, invalidate: () => { invalidations++; }, status: () => ({ hasToken: true, expiresAt: null }) } as QqTokenSource;
const keyboard = qqButtons("test", [{ id: "ok", label: "ok", visited: "done", data: "ok" }]);
const payloads: any[] = [];
let replies: (Response | Error)[] = [];
const fetch = async (_url: string, init?: RequestInit) => {
  payloads.push(JSON.parse(String(init?.body)));
  const response = replies.shift();
  if (response instanceof Error) throw response;
  return response ?? Response.json({ id: "receipt" });
};
const base = { tokens, fetch, openid: "owner", content: "# 标题\n\n[项目](https://github.com/a/b)" };
const send = (extra = {}) => sendQqC2c({ ...base, ...extra });
assert.equal((await send({ format: "markdown" })).outcome, "accepted");
assert.deepEqual(payloads.at(-1), { markdown: { content: base.content }, msg_type: 2, msg_seq: 1 });
await send(); assert.equal(payloads.at(-1).msg_type, 0);
await send({ format: "text" }); assert.equal(payloads.at(-1).msg_type, 0);
await send({ mediaFileInfo: "image", replyTo: "incoming", msgSeq: 3 });
assert.deepEqual(payloads.at(-1), { content: base.content, msg_type: 7, media: { file_info: "image" }, msg_id: "incoming", msg_seq: 3 });
await send({ keyboard }); assert.equal(payloads.at(-1).msg_type, 2); assert.deepEqual(payloads.at(-1).keyboard, keyboard);
await send({ keyboard, mediaFileInfo: "legacy" }); assert.equal(payloads.at(-1).msg_type, 2); assert.equal(payloads.at(-1).media, undefined);
await send({ format: "text", keyboard, mediaFileInfo: "legacy" }); assert.equal(payloads.at(-1).msg_type, 2);
for (const extra of [{ format: "html" }, { format: null }, { format: 2 }, { format: "markdown", mediaFileInfo: "image" }, { format: "markdown", mediaFileInfo: "image", keyboard }, { format: "markdown", content: "x".repeat(2001) }, { keyboard, content: "x".repeat(2001) }]) {
  const before = payloads.length, tokensBefore = gets;
  const result = await send(extra);
  assert.equal(result.outcome, "rejected"); assert.equal((result as any).retryable, false); assert.match((result as any).error, /^invalid:/);
  assert.equal(payloads.length, before); assert.equal(gets, tokensBefore);
}
await send({ format: "markdown", content: "x".repeat(2000) }); assert.equal(payloads.at(-1).markdown.content.length, 2000);
await send({ content: "x".repeat(2001) }); assert.equal(payloads.at(-1).content.length, 2000);
for (const [response, outcome, retryable] of [
  [Response.json({ code: 123 }, { status: 400 }), "rejected", false],
  [Response.json({ code: 40034100 }, { status: 400 }), "rejected", true],
  [Response.json({}, { status: 429 }), "rejected", true],
  [Response.json({}, { status: 503 }), "uncertain", undefined],
  [Response.json({}), "uncertain", undefined],
  [new Error("lost response"), "uncertain", undefined],
] as const) {
  replies = [response]; const before = payloads.length;
  const result = await send({ format: "markdown" });
  assert.equal(result.outcome, outcome); assert.equal((result as any).retryable, retryable); assert.equal(payloads.length, before + 1);
}
replies = [Response.json({}, { status: 401 }), Response.json({ id: "refreshed" })];
let before = payloads.length;
assert.equal((await send({ format: "markdown" })).outcome, "accepted");
assert.equal(invalidations, 1); assert.equal(payloads.length, before + 2); assert.deepEqual(payloads.at(-1), payloads.at(-2));
replies = [Response.json({}, { status: 401 }), Response.json({}, { status: 401 })];
assert.deepEqual(await send({ format: "markdown" }), { outcome: "rejected", retryable: true, error: "QQ rejected the message (401)" });

replies = [Response.json({}, { status: 401 }), new Error("refresh send lost")]; before = payloads.length;
assert.equal((await send({ format: "markdown" })).outcome, "uncertain"); assert.equal(payloads.length, before + 2);
const unavailable = { ...tokens, get: async () => { throw new Error("offline token unavailable"); } };
before = payloads.length;
assert.deepEqual(await send({ tokens: unavailable, format: "markdown" }), { outcome: "rejected", retryable: true, error: "QQ token unavailable" }); assert.equal(payloads.length, before);

const message: DeliveryMessage = { idempotencyKey: "event-1", format: "markdown", title: "Title [x](evil)\n# Inject", body: base.content, link: "/sessions/a(b)", recipient: null };
const delivery = createChronaQqDelivery({ tokens, fetch, allowedRecipients: () => new Set(["chrona_qq:owner"]), publicUrl: "https://chrona.example", perMinute: 100 });
await delivery.send(message);
assert.equal(payloads.at(-1).msg_type, 2);
assert.equal(payloads.at(-1).markdown.content, [escapeQqTitle(message.title), message.body, "[打开 Chrona](https://chrona.example/sessions/a%28b%29)"].join("\n\n"));
assert.equal(escapeQqTitle("[bad](url)\n# title"), "\\[bad\\]\\(url\\) \\# title");
for (const link of ["javascript:alert(1)", "//evil.example/path", "https://user:pass@evil.example", "https://good.example/\n[evil]", "/\\evil.example"]) {
  before = payloads.length;
  const result = await delivery.send({ ...message, link });
  assert.equal(result.outcome, "rejected"); assert.match((result as any).error, /^invalid:/); assert.equal(payloads.length, before);
}
assert.throws(() => markdownAppLink("/path", "javascript:evil"));
for (const extra of [{ body: "x".repeat(2000) }, { link: "https://chrona.example/" + "a".repeat(2100) }, { format: "unknown" as any }]) {
  before = payloads.length; assert.equal((await delivery.send({ ...message, ...extra })).outcome, "rejected"); assert.equal(payloads.length, before);
}
// QQ format/URL policy rejection is real: neither explicit Markdown nor explicit Markdown+buttons is downgraded.
for (const approval of [undefined, { id: "12345678-abcd", scoped: true }]) {
  replies = [Response.json({ code: 123 }, { status: 400 })]; before = payloads.length;
  const result = await delivery.send({ ...message, approval });
  assert.equal(result.outcome, "rejected"); assert.equal(payloads.length, before + 1); assert.equal(payloads.at(-1).msg_type, 2);
}
replies = [new Error("uncertain active delivery")]; before = payloads.length;
assert.equal((await delivery.send({ ...message, approval: { id: "12345678", scoped: false } })).outcome, "uncertain"); assert.equal(payloads.length, before + 1);
// The pre-existing text approval permission fallback remains; explicit Markdown above never uses it.
replies = [Response.json({}, { status: 400 }), Response.json({ id: "fallback" })]; before = payloads.length;
assert.equal((await delivery.send({ ...message, format: "text", approval: { id: "12345678", scoped: false } })).outcome, "accepted");
assert.equal(payloads.length, before + 2); assert.equal(payloads.at(-2).msg_type, 2); assert.equal(payloads.at(-1).msg_type, 0);
// Authorization and local rate limiting still gate sends.
assert.equal((await delivery.send({ ...message, recipient: "chrona_qq:stranger" })).outcome, "rejected");
const limited = createChronaQqDelivery({ tokens, fetch, allowedRecipients: () => new Set(["chrona_qq:owner"]), perMinute: 1 });
await limited.send({ ...message, link: null }); before = payloads.length;
assert.deepEqual(await limited.send({ ...message, link: null }), { outcome: "rejected", retryable: true, error: "Local QQ rate limit" }); assert.equal(payloads.length, before);
console.log("format payload, validation, failures and compatibility tests passed");

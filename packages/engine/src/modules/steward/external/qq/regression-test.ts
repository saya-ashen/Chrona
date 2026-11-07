/* eslint-disable @typescript-eslint/no-explicit-any -- Offline author test: drives the untyped fake kernel and fetch stubs. */
import { strict as assert } from "node:assert";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { startModule, paths } from "chrona/testing";
import { createQqBotState, createQqBotHandler, createQqPassiveReplies, parseApprovalDecision } from "./bot";
import { createRelay } from "./relay";
import { parseC2cEvent, downloadQqAttachment } from "./official";

const now = new Date("2026-10-25T14:00:00Z"), appId = "123456";
const state = createQqBotState(paths.data, appId);
const challenge = await state.createChallenge({ workspaceId: "workspace", now });
assert.equal((await state.redeem("owner", "wrong", now)).ok, false);
assert.equal((await state.redeem("owner", challenge.code, now)).ok, true);
assert.equal((await state.redeem("stranger", challenge.code, now)).ok, false);
assert.equal((await createQqBotState(paths.data, appId).binding())?.openid, "owner");
const binding = (await state.binding())!;
const chats: any[] = [], texts: string[] = [], decisions: any[] = [];
const handler = createQqBotHandler({ state, now: () => now,
  chat: { send: async input => { chats.push(input); return { reply: "done" }; } },
  reply: async (_owner, _id, text) => { texts.push(text); }, enqueueFinal: async () => {},
  resolveApproval: async (_binding, decision) => { decisions.push(decision); return "approved"; },
});
const incoming = { id: "incoming-1", openid: "owner", content: "hello", quoted: "", timestamp: now.toISOString() };
await handler.onMessage(incoming); await handler.onMessage(incoming);
await handler.onMessage({ ...incoming, id: "incoming-2" });
assert.equal(chats.length, 2); assert.notEqual(chats[0].externalId, chats[1].externalId);
await handler.onMessage({ ...incoming, id: "stranger", openid: "stranger" }); assert.equal(chats.length, 2);
await handler.onMessage({ ...incoming, id: "approval", content: "批准 abcdef12 始终" }); assert.equal(decisions[0].scope, "always");
assert.deepEqual(parseApprovalDecision({ button: "approval:12345678-1234-1234-1234-123456789abc:deny" }), { ref: "12345678-1234-1234-1234-123456789abc", decision: "deny", scope: "once" });
// Replay protection survives restart.
const restarted = createQqBotHandler({ state: createQqBotState(paths.data, appId), now: () => now, chat: { send: async input => { chats.push(input); return { reply: "done" }; } }, reply: async () => {}, enqueueFinal: async () => {} });
await restarted.onMessage(incoming); assert.equal(chats.length, 2);
let reservations = 0;
const passive = createQqPassiveReplies(async () => { reservations++; throw new Error("network uncertain"); }, () => now.getTime());
for (let i = 0; i < 4; i++) await passive(incoming, "reply").catch(() => {});
assert.equal(await passive(incoming, "reply"), false); assert.equal(reservations, 4);

const calls: any[] = [], notices: any[] = [];
const relay = createRelay({ publicUrl: null, download: async a => ({ name: a.name, mime: "image/png", bytes: new Uint8Array([1]) }), notify: async args => { notices.push(args); }, call: async (target, args) => { calls.push({ target, args }); if (target === "chat.conversation-state") return { now: now.toISOString(), limits: { idleMinutes: 60, minContextTokens: 30000, maxContextTokens: 100000 }, session: null }; if (target === "approvals.list") return [{ id: "abcdef12-0000", title: "approval" }]; return "attachment-ref"; } });
const parsed = parseC2cEvent({ id: "picture", author: { user_openid: "owner" }, content: "", timestamp: now.toISOString(), attachments: [{ url: "https://gchat.qpic.cn/image", filename: "image.png", content_type: "image/png" }] })!;
assert.equal(parsed.attachments?.length, 1);
await relay.send({ workspaceId: binding.workspaceId, key: "qq:dm", channel: "chrona_qqbot", text: "", externalId: parsed.id, attachments: parsed.attachments });
assert.deepEqual(calls.map(c => c.target), ["chat.attach", "chat.conversation-state", "chat.send"]);
await relay.resolveApproval(binding, { ref: "abcdef12", decision: "approve", scope: "once" });
assert.equal(calls.at(-1).target, "approvals.resolve");
await relay.enqueueFinal("event-a", "a", "chrona_qq:owner"); await relay.enqueueFinal("event-b", "b", "chrona_qq:owner");
assert.notEqual(notices[0].key, notices[1].key); assert.equal(notices[0].recipient, "chrona_qq:owner");
const image = await downloadQqAttachment(parsed.attachments![0], async () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "content-type": "application/octet-stream" } }));
assert.equal(image.mime, "image/png");
await assert.rejects(downloadQqAttachment({ url: "https://evil.invalid/image", name: "x", mime: "image/png" }, async () => { throw new Error("must not fetch"); }));

// The real entry's deliver handler -> bot -> official transport, with all network stubbed in the child.
await mkdir(paths.data, { recursive: true });
const mod = await startModule("offline-harness.ts", { stubs: { secret: () => ({ value: { appId, clientSecret: "fake-test-secret" } }) } });
try {
  for (let i = 0; i < 200 && !mod.calls.some((c: { params: { target?: unknown } }) => c.params.target === "notify.channel"); i++) await new Promise(r => setTimeout(r, 10));
  const deliver = async (key: string, extra: Record<string, unknown> = {}) => mod.send({ trigger: { kind: "tool", id: "deliver", firedAt: now.toISOString(), args: { key, title: "Title", body: "**markdown**", ...extra } }, now: now.toISOString(), params: {} });
  assert.equal((await deliver("explicit", { format: "markdown" })).result?.result.outcome, "accepted");
  assert.equal((await deliver("default")).result?.result.outcome, "accepted");
  for (const format of [null, "html", 3]) {
    const invalid = (await deliver("bad", { format })).result?.result;
    assert.equal(invalid.outcome, "rejected"); assert.match(invalid.error, /^invalid:/);
  }
  const payloads = (await readFile(join(paths.data, "offline-payloads.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(payloads.length, 2); assert.equal(payloads[0].msg_type, 2); assert.equal(payloads[0].markdown.content, "Title\n\n**markdown**"); assert.equal(payloads[1].msg_type, 0);
  const records = mod.calls.filter((c: { params: { target?: unknown } }) => c.params.target === "chat.record"); assert.equal(records.length, 2);
} finally { await mod.stop(); }
console.log("binding, authorization, replay, approval, images, relay and entry integration passed");

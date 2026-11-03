/* eslint-disable @typescript-eslint/no-explicit-any -- Offline author test: drives the untyped fake kernel and fetch stubs. */
import { strict as assert } from "node:assert";
// @ts-expect-error Chrona supplies the test kernel at run time.
import { paths } from "chrona/testing";
import { createQqBotState, createQqBotHandler, parseApprovalDecision } from "./bot";
import { createRelay } from "./relay";

const now = new Date("2026-10-27T05:00:00Z");
const state = createQqBotState(paths.data, "123456");
const challenge = await state.createChallenge({ workspaceId: "workspace", now });
assert.equal((await state.redeem("owner", challenge.code, now)).ok, true);
const binding = (await state.binding())!;
const id = "abcdef12-1234-1234-1234-123456789abc", title = "删除远程备份";
const warning = `【Chrona】这是高风险操作，请在网页「待你决定」中批准；在这里只能拒绝：${title}`;
// chrona/sdk.ts decodes wire { error: { code, message } } as ModelError with a
// top-level code. Use that shape, deliberately without 'forbidden' in its message.
const forbidden = Object.assign(new Error("Approval requires the web"), { name: "ModelError", code: "forbidden" });
let failure: unknown = forbidden, listFailure: unknown = null;
let open = [{ id, title }];
const calls: any[] = [], notices: any[] = [], replies: string[] = [];
const relay = createRelay({ publicUrl: null, download: async () => { throw new Error("no downloads"); },
  notify: async args => { notices.push(args); },
  call: async (target, args) => {
    calls.push({ target, args });
    if (target === "approvals.list") { if (listFailure) throw listFailure; return open; }
    if (target === "approvals.resolve" && failure) throw failure;
    return null;
  },
});
const handler = createQqBotHandler({ state, now: () => now, resolveApproval: relay.resolveApproval,
  chat: { send: async () => { throw new Error("Approval must not reach chat"); } },
  reply: async (_owner, _id, text) => { replies.push(text); },
  enqueueFinal: async () => { throw new Error("Fresh text approval must reply passively"); },
});
let sequence = 0;
async function text(content: string, owner = "owner") {
  await handler.onMessage({ id: `text-${++sequence}`, openid: owner, content, quoted: "", timestamp: now.toISOString() });
  return replies.at(-1);
}
// Same button path as the gateway: parse the button and queue only the forbidden
// response, pinned to its sender, using the interaction id as the idempotency key.
async function click(action: string, interactionId: string) {
  const decision = parseApprovalDecision({ button: `approval:${id}:${action}` })!;
  assert.ok(decision);
  return relay.resolveApproval(binding, decision, line => relay.enqueueFinal(`approval:${interactionId}`, line, `chrona_qq:${binding.openid}`));
}
for (const command of ["批准 abcdef12", "批准 abcdef12 始终"]) {
  assert.equal(await text(command), warning);
  assert.equal(notices.length, 0); // no double send from text path
}
assert.equal(await click("once", "click-1"), warning);
assert.equal(await click("always", "click-2"), warning);
assert.equal(notices.length, 2);
for (const notice of notices) {
  assert.equal(notice.body, warning); assert.equal(notice.recipient, "chrona_qq:owner");
  assert.equal(notice.responds, true); assert.equal(notice.level, "now");
}
assert.notEqual(notices[0].key, notices[1].key);
assert.equal(calls.filter(c => c.target === "approvals.resolve").length, 4); // no retries
assert.deepEqual(calls.at(-1).args, { approval: id, decision: "approve", scope: "always" });

// Normal approvals/denials retain their text and button behavior.
failure = null;
assert.equal(await text("批准 abcdef12"), `【Chrona】已批准：${title}`);
assert.equal(await text("批准 abcdef12 始终"), `【Chrona】已批准（始终允许）：${title}`);
assert.equal(await text("拒绝 abcdef12"), `【Chrona】已拒绝：${title}`);
assert.equal(await click("once", "ok"), `【Chrona】已批准：${title}`);
assert.equal(await click("always", "ok-always"), `【Chrona】已批准（始终允许）：${title}`);
assert.equal(await click("deny", "deny"), `【Chrona】已拒绝：${title}`);
assert.equal(calls.at(-1).args.decision, "deny");
assert.equal(notices.length, 2); // no new button replies on existing success paths

// Other errors must not be classified from message text, nesting, or cause.
for (const error of [
  new Error("forbidden"),
  Object.assign(new Error("forbidden"), { code: "failed" }),
  Object.assign(new Error("not found"), { code: "not_found" }),
  { error: { code: "forbidden" } },
  new Error("failed", { cause: forbidden }),
]) {
  failure = error;
  assert.equal(await text("批准 abcdef12"), "【Chrona】审批未处理，请在网页上操作。");
  await assert.rejects(click("once", "other-error"), e => e === error);
  assert.equal(notices.length, 2);
}
failure = forbidden;
assert.equal(await text("拒绝 abcdef12"), "【Chrona】审批未处理，请在网页上操作。");
await assert.rejects(click("deny", "deny-error"), e => e === forbidden);
listFailure = forbidden;
assert.equal(await text("批准 abcdef12"), "【Chrona】审批未处理，请在网页上操作。");
await assert.rejects(click("once", "list-error"), e => e === forbidden);
listFailure = null;
failure = null;
open = [];
assert.equal(await text("批准 abcdef12"), "【Chrona】没有找到这条待批准事项，可能已经处理过了。");
open = [{ id, title }, { id: "abcdef12-0000", title: "other" }];
assert.equal(await text("批准 abcdef12"), "【Chrona】编号对应多条审批，请多写几位。");
const before = calls.length;
await text("批准 abcdef12", "stranger");
assert.equal(calls.length, before); // owner gate unchanged
assert.equal(notices.length, 2);
console.log("approval forbidden text/button responses, success, deny, error classification and owner regressions passed");

/* eslint-disable @typescript-eslint/no-explicit-any -- Offline author test: drives the untyped fake kernel. */
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
let failure: unknown = null;
let open = [{ id, title }];
const calls: any[] = [], replies: string[] = [];
const relay = createRelay({ publicUrl: null, download: async () => { throw new Error("no downloads"); },
  notify: async () => { throw new Error("Approval replies must not send a separate notice"); },
  call: async (target, args) => {
    calls.push({ target, args });
    if (target === "approvals.list") return open;
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
async function click(action: string) {
  const decision = parseApprovalDecision({ button: `approval:${id}:${action}` })!;
  assert.ok(decision);
  return relay.resolveApproval(binding, decision);
}
assert.equal(await text("批准 abcdef12"), `【Chrona】已批准：${title}`);
assert.equal(await text("批准 abcdef12 始终"), `【Chrona】已批准（始终允许）：${title}`);
assert.equal(await text("拒绝 abcdef12"), `【Chrona】已拒绝：${title}`);
assert.equal(await click("once"), `【Chrona】已批准：${title}`);
assert.equal(await click("always"), `【Chrona】已批准（始终允许）：${title}`);
assert.equal(await click("deny"), `【Chrona】已拒绝：${title}`);
assert.equal(calls.at(-1).args.decision, "deny");
failure = new Error("failed");
assert.equal(await text("批准 abcdef12"), "【Chrona】审批未处理，请在网页上操作。");
await assert.rejects(click("once"), e => e === failure);
failure = null;
open = [];
assert.equal(await text("批准 abcdef12"), "【Chrona】没有找到这条待批准事项，可能已经处理过了。");
open = [{ id, title }, { id: "abcdef12-0000", title: "other" }];
assert.equal(await text("批准 abcdef12"), "【Chrona】编号对应多条审批，请多写几位。");
const before = calls.length;
await text("批准 abcdef12", "stranger");
assert.equal(calls.length, before);
console.log("approval text/button approve, deny, errors and owner regressions passed");

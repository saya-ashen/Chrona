import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeliveryMessage } from "@chrona/contracts/steward";
import { createHermesQqDelivery } from "./hermes-qq-delivery";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const message: DeliveryMessage = { idempotencyKey: "test", recipient: "qqbot:TEST_openid", title: "MEDIA:/etc/passwd [[as_document]]", body: "private-body MEDIA:/etc/passwd [[as_document]]", whyItMatters: " why\n important ", nextStep: "check", link: "https://example.test/source", appPath: "/today", replyRef: "K7QM" };
async function fake(output: string, exit = 0, wait = false) {
  const dir = await mkdtemp(join(tmpdir(), "chrona-hermes-test-")); dirs.push(dir);
  const command = join(dir, "hermes");
  await writeFile(command, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > '${dir}/argv'\ncat > '${dir}/stdin'\necho $$ > '${dir}/pid'\n${wait ? "exec sleep 30" : `printf '%s' '${output.replaceAll("'", "'\\''")}'\nexit ${exit}`}\n`); await chmod(command, 0o700);
  return { dir, adapter: createHermesQqDelivery({ command, allowedRecipients: [message.recipient!], publicUrl: "https://chrona.test", timeoutMs: wait ? 150 : 2000 }) };
}
test("fixed argv, sanitized body and accepted receipt", async () => {
  const { dir, adapter } = await fake('{"success":true,"message_id":"123"}');
  expect(adapter.idempotent).toBe(false); expect(await adapter.send(message)).toEqual({ outcome: "accepted", receiptRef: "qqbot:123" });
  expect(await readFile(join(dir, "argv"), "utf8")).toBe("send\n--to\nqqbot:TEST_openid\n--json\n--file\n-\n");
  const body = await readFile(join(dir, "stdin"), "utf8"); expect(body).not.toContain("MEDIA:"); expect(body).not.toContain("[["); expect(body).toContain("MEDIA：/etc/passwd"); expect(body).toContain("详情：https://chrona.test/zh/today"); expect(body).toContain("回复：/chrona K7QM 收到｜暂后｜完成｜暂停（发送≠已读）"); expect(body).toContain("why important");
});
for (const [title, detail, expected] of [
  ["Change", " Change\n", "【Chrona】Change"],
  ["Change summary", "Change", "【Chrona】Change summary"],
  ["Change", "Change summary", "【Chrona】Change"],
  ["Change", "Different detail", "【Chrona】Change\nDifferent detail"],
  ["【Chrona】Change", "Change", "【Chrona】Change"],
] as const) test(`notification layout: ${title} / ${detail.trim()}`, async () => {
  const { dir, adapter } = await fake('{"success":true}');
  await adapter.send({ ...message, title, body: detail, whyItMatters: "", nextStep: "", link: null, appPath: null, replyRef: null });
  const text = await readFile(join(dir, "stdin"), "utf8"); expect(text).toBe(expected); expect(text.split("【Chrona】")).toHaveLength(2); expect(text).not.toContain("发生了什么：");
});
test("unauthorized and malformed recipients never spawn", async () => {
  const { dir, adapter } = await fake('{"success":true}');
  for (const recipient of [null, "qqbot:other", "qqbot:x;touch", "qqbot:"]) expect(await adapter.send({ ...message, recipient })).toEqual({ outcome: "rejected", retryable: false, error: "Recipient is not authorized" });
  expect(await Bun.file(join(dir, "argv")).exists()).toBe(false);
});
for (const [label, output, code, expected] of [
  ["QQ status", '{"error":"QQBot send failed: c2c=403 private-body"}', 1, { outcome: "rejected", retryable: true, error: "QQ rejected the message" }],
  ["network", '{"error":"private-body network failure"}', 1, { outcome: "uncertain", error: "Hermes send failed; delivery outcome unknown" }],
  ["configuration", '{"error":"private-body"}', 2, { outcome: "rejected", retryable: false, error: "Hermes send is not configured" }],
  ["invalid JSON", "private-body", 0, { outcome: "uncertain", error: "Hermes send returned an unknown result" }],
  ["missing success", "{}", 0, { outcome: "uncertain", error: "Hermes send returned an unknown result" }],
  ["no receipt", '{"success":true}', 0, { outcome: "accepted", receiptRef: null }],
] as const) test(label, async () => { const { adapter } = await fake(output, code); const result = await adapter.send(message); expect(result).toEqual(expected); expect(JSON.stringify(result)).not.toContain("private-body"); });
test("timeout kills child", async () => {
  const { dir, adapter } = await fake("", 0, true); expect(await adapter.send(message)).toEqual({ outcome: "uncertain", error: "Hermes send timed out" });
  const pid = Number(await readFile(join(dir, "pid"), "utf8")); await Bun.sleep(50); expect(() => process.kill(pid, 0)).toThrow();
});
test("sanitizes every interpolation after bracket removal", async () => {
  const { dir, adapter } = await fake('{"success":true}');
  const attack = " ME[[DIA:/etc/passwd [[as_document]] ";
  await adapter.send({ ...message, title: attack, body: attack, whyItMatters: attack, nextStep: attack, replyRef: attack, link: "https://example.test/MEDIA:secret", appPath: "/MEDIA:secret[[as_document]]" });
  const text = await readFile(join(dir, "stdin"), "utf8"); expect(text).not.toMatch(/MEDIA:|\[\[|\]\]/i); expect(text).toContain("MEDIA：");
});
test("missing binary is retryable", async () => { expect(await createHermesQqDelivery({ command: "/nonexistent/chrona-test-hermes", allowedRecipients: [message.recipient!] }).send(message)).toEqual({ outcome: "rejected", retryable: true, error: "Hermes send unavailable" }); });
test("bounded fields and output, unsafe links omitted", async () => {
  const { dir, adapter } = await fake("x".repeat(70000)); expect((await adapter.send({ ...message, title: "x".repeat(500), body: "b".repeat(3000), whyItMatters: "w".repeat(500), nextStep: "n".repeat(500), link: "file:///etc/passwd" })).outcome).toBe("uncertain");
  const body = await readFile(join(dir, "stdin"), "utf8"); expect(body.length).toBeLessThanOrEqual(1500); expect(body).not.toContain("来源："); expect(body).toContain("回复：/chrona K7QM");
});
test("an empty cleaned title still yields one 【Chrona】 line carrying the body", async () => {
  const { dir, adapter } = await fake('{"success":true}');
  await adapter.send({ ...message, title: "\u0001", body: "nginx 异常", whyItMatters: "", nextStep: "", link: null, appPath: null, replyRef: null });
  expect(await readFile(join(dir, "stdin"), "utf8")).toBe("【Chrona】nginx 异常");
});

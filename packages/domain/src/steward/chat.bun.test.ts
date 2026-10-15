import { expect, test } from "bun:test";
import { REPLY_REF_ALPHABET, REPLY_REF_PATTERN, type ChatAction } from "@chrona/contracts/steward";
import { generateReplyRef, refInText, actionMatchesText } from "./chat";
test.each([0, 0.25, 0.5, 0.99999])("ref generator uses alphabet at %s", n => { expect(generateReplyRef(() => n)).toBe(REPLY_REF_ALPHABET[Math.floor(n * REPLY_REF_ALPHABET.length)]!.repeat(4)); expect(generateReplyRef(() => n)).toMatch(REPLY_REF_PATTERN); });
test.each([["确认K7QM", true], ["k7qm 暂停", true], ["(K7QM)", true], ["XK7QM", false], ["K7QM2", false], ["K7QM_", true], ["", false]] as const)("ASCII boundaries: %s", (text, expected) => expect(refInText(text, "K7QM")).toBe(expected));
test.each([["confirm", "好的"], ["decline", "不要"], ["snooze", "稍后"], ["done", "搞定"], ["dismiss", "忽略"], ["less_often", "少提醒"], ["pause", "暂停"], ["resume", "恢复"], ["revoke", "取消"], ["ack", "收到"], ["feedback", ""]] as [ChatAction, string][])("action %s", (action, text) => expect(actionMatchesText(action, text)).toBe(true));
test("bare 好 is not confirmation; 好的 is; keywords are case insensitive", () => { expect(actionMatchesText("confirm", "好")).toBe(false); expect(actionMatchesText("confirm", "好的")).toBe(true); expect(actionMatchesText("confirm", "OK")).toBe(true); expect(actionMatchesText("confirm", "暂停 K7QM")).toBe(false); });
test.each([
  ["confirm", "不同意 K7QM", false], ["confirm", "我不确认 K7QM", false], ["confirm", "确认取消 K7QM", false], ["confirm", "可以，确认 K7QM", true],
  ["pause", "别暂停 K7QM", false], ["pause", "确认暂停 K7QM", true], ["resume", "继续暂停 K7QM", false],
  ["decline", "I don't know K7QM", false], ["decline", "no K7QM", true], ["confirm", "book K7QM", false], ["less_often", "unless K7QM", false], ["revoke", "don't stop K7QM", false],
] as [ChatAction, string, boolean][])("negation, word boundaries and contradictions: %s %s", (action, text, expected) => expect(actionMatchesText(action, text)).toBe(expected));

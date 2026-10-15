import { expect, it } from "vitest";
import en from "@chrona/i18n/messages/en.json";
import zh from "@chrona/i18n/messages/zh.json";
import { channelLabel, maskRecipient, replyText, showReplyHint } from "./chat";
it.each([["in_app", "Chrona 内"], ["local_test", "测试接收端"], ["hermes_qqbot", "QQ 私聊（经 Hermes）"], ["chrona_qqbot", "QQ 私聊（Chrona 专用机器人）"], ["future-channel", "future-channel"], ["toString", "toString"]])("labels %s", (channel, label) => { expect(channelLabel(channel, zh.steward.controls)).toBe(label); });
it.each(["in_app", "local_test", "hermes_qqbot", "chrona_qqbot"] as const)("localizes %s", channel => { expect(channelLabel(channel, en.steward.controls)).toBe(en.steward.controls[channel]); });
it.each([[null, null], ["", null], ["qqbot:1741306CEFED52771EF2DE2746A70A12", "QQ 1741…0A12"], ["qqbot:12345678", "QQ …"], ["qqbot:x", "QQ …"], ["qqbot:", "QQ …"], ["chrona_qq:ABCDEF0123456789", "QQ ABCD…6789"], ["other:private-id", "…"]])("masks %s", (recipient, expected) => { expect(maskRecipient(recipient)).toBe(expected); });
it.each([["proposed", true], ["active", true], ["paused", true], ["revoked", false], ["expired", false]] as const)("reply hint for %s", (status, expected) => { expect(showReplyHint(status)).toBe(expected); });
it.each([[zh.steward.chat.replyRef, "回复码 K7QM"], [zh.steward.chat.replyHint, "在 QQ 中回复『确认/暂停/撤销 K7QM』"], [en.steward.chat.replyRef, "Reply code K7QM"]])("formats %s", (template, expected) => { expect(replyText(template, "K7QM")).toBe(expected); });

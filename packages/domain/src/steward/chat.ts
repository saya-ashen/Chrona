import { REPLY_REF_ALPHABET, type ChatAction } from "@chrona/contracts/steward";
export function generateReplyRef(random: () => number = Math.random): string {
  return Array.from({ length: 4 }, () => REPLY_REF_ALPHABET[Math.floor(random() * REPLY_REF_ALPHABET.length)]).join("");
}
export function refInText(text: string, ref: string): boolean {
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
}
const keywords: Record<Exclude<ChatAction, "feedback">, string[]> = {
  confirm: ["确认", "同意", "批准", "开始", "可以", "好的", "confirm", "approve", "yes", "ok"], decline: ["拒绝", "不要", "不用了", "算了", "decline", "no"],
  snooze: ["暂后", "稍后", "晚点", "推迟", "延后", "snooze", "later"], done: ["完成", "已处理", "处理好", "搞定", "done"], dismiss: ["忽略", "不用管", "无关", "dismiss", "ignore"],
  less_often: ["少提醒", "少点", "降低频率", "less"], pause: ["暂停", "pause"], resume: ["恢复", "继续", "resume"], revoke: ["撤销", "停止", "取消", "别再", "revoke", "stop"], ack: ["收到", "知道了", "已读", "看到了", "ack", "seen"],
};
const NEGATION = /[不别没未勿](?:要|再|用)?$/;
const ascii = (word: string) => /^[a-z_]+$/.test(word);
function mentions(text: string, word: string): boolean {
  const lower = text.toLowerCase();
  if (ascii(word)) return new RegExp(`(?<![a-z])${word}(?![a-z])`).test(lower) && !new RegExp(`\\b(?:not|don't|dont|no)\\s+${word}\\b`).test(lower);
  // A Chinese keyword directly after a negation ("不同意", "别暂停") does not express that action.
  for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) if (!NEGATION.test(lower.slice(Math.max(0, at - 2), at))) return true;
  return false;
}
/** Confirming must not be mixed with any withdrawing word ("确认取消 K7QM" is ambiguous). */
const CONTRADICTS: Partial<Record<ChatAction, Exclude<ChatAction, "feedback">[]>> = { confirm: ["decline", "revoke", "pause"], resume: ["pause", "revoke"] };
export function actionMatchesText(action: ChatAction, text: string): boolean {
  if (action === "feedback") return true;
  return keywords[action].some(word => mentions(text, word)) && !(CONTRADICTS[action] ?? []).some(other => keywords[other].some(word => mentions(text, word)));
}

import type { DelegationStatus } from "@chrona/contracts";

type ChannelCopy = { in_app: string; local_test: string; hermes_qqbot: string; chrona_qqbot: string };
export function channelLabel(channel: string, copy: ChannelCopy) { return channel === "in_app" || channel === "local_test" || channel === "hermes_qqbot" || channel === "chrona_qqbot" ? copy[channel] : channel; }
/** Never expose a complete destination, including short or unrecognized IDs. */
export function maskRecipient(recipient: string | null) {
  if (!recipient) return null;
  const prefix = ["qqbot:", "chrona_qq:"].find(value => recipient.startsWith(value));
  if (!prefix) return "…";
  const id = recipient.slice(prefix.length);
  return `QQ ${id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : "…"}`;
}
export function replyText(template: string, ref: string) { return template.replace("{ref}", () => ref); }
export function showReplyHint(status: DelegationStatus) { return status === "proposed" || status === "active" || status === "paused"; }

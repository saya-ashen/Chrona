import { SUGGESTION_COOLDOWN_DAYS, type Ask } from "@chrona/contracts/steward";

const normalize = (topic: string) => topic.replace(/\s+/gu, "").toLowerCase();
export function canSuggest(topic: string, recentAsks: readonly Ask[], now: Date): boolean {
  return !recentAsks.some((ask) => {
    if (ask.kind !== "suggestion" || ask.topic === null || normalize(ask.topic) !== normalize(topic)) return false;
    if (ask.status === "open" || ask.decision === "never_again") return true;
    if (ask.status !== "dismissed") return false;
    const until = ask.cooldownUntil !== null ? Date.parse(ask.cooldownUntil)
      : ask.resolvedAt !== null ? Date.parse(ask.resolvedAt) + SUGGESTION_COOLDOWN_DAYS * 86_400_000 : Infinity;
    return !(now.getTime() >= until);
  });
}

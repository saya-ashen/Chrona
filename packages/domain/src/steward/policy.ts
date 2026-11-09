import { DEFAULT_POLICY, type Action, type Grant, type GrantMode, type PolicyDecision } from "@chrona/contracts/steward";

type Target = { moduleId?: string };
const labels: Record<Action, string> = {
  activate_module: "启用模块", delete_data: "删除数据", modify_external: "修改外部系统",
};
const modes: Record<GrantMode, string> = { allow: "允许", ask: "需要先问你" };
function specificity(grant: Grant, target: Target): number {
  const scope = grant.scope;
  switch (scope.kind) {
    case "global": return 0;
    case "module": return scope.moduleId === target.moduleId ? 1 : -1;
  }
}
function isUsableGrant(grant: Grant, action: Action, now: Date): boolean {
  return grant.action === action && grant.revokedAt === null
    && !(grant.once && grant.consumedAt !== null)
    && (grant.expiresAt === null || Date.parse(grant.expiresAt) > now.getTime());
}
function policyReason(action: Action, mode: GrantMode, chosen?: Grant): string {
  const prefix = !chosen ? "内置规则：" : chosen.scope.kind === "module" ? "你为这个模块允许过：" : "你的授权规则：";
  return `${prefix}${labels[action]}${modes[mode]}`;
}
/** Same scope: a one-time grant beats a standing rule; otherwise ask beats allow. */
function preferred(grant: Grant, chosen: Grant) {
  if (grant.once !== chosen.once) return grant.once;
  return grant.mode === "ask" && chosen.mode === "allow";
}
function chooseGrant(action: Action, target: Target, grants: readonly Grant[], now: Date): Grant | undefined {
  let chosen: Grant | undefined;
  let rank = -1;
  for (const grant of grants) {
    if (!isUsableGrant(grant, action, now)) continue;
    const next = specificity(grant, target);
    if (next < 0) continue;
    if (next > rank || (next === rank && chosen && preferred(grant, chosen))) {
      chosen = grant;
      rank = next;
    }
  }
  return chosen;
}
export function decidePolicy(action: Action, target: Target, grants: readonly Grant[], now: Date): PolicyDecision {
  const fallback: GrantMode = DEFAULT_POLICY[action];
  const chosen = chooseGrant(action, target, grants, now);
  const mode = chosen?.mode ?? fallback;
  return { action, mode, grantId: chosen?.id ?? null, reason: policyReason(action, mode, chosen) };
}

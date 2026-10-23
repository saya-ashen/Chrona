import { DEFAULT_POLICY, type Action, type Grant, type GrantMode, type PolicyDecision } from "@chrona/contracts/steward";

export const MODE_STRICTNESS = { auto: 0, notify_after: 1, preapproved: 2, ask: 3, never: 4 } as const satisfies Record<GrantMode, number>;
type Target = { moduleId?: string; connectorId?: string };
const labels: Record<Action, string> = {
  read_source: "读取来源", notify_user: "通知你", schedule: "设置调度",
  activate_module: "启用模块", send_external_message: "对外发消息", modify_external: "修改外部系统", purchase: "购买",
  delete_data: "删除数据", connect_source: "接入来源", share_third_party: "向第三方分享", change_credentials: "修改凭据", access_host_path: "访问本机目录",
};
const modes: Record<GrantMode, string> = { auto: "可以直接做", notify_after: "做完告诉你", preapproved: "按授权执行", ask: "需要先问你", never: "留给你处理" };
function specificity(grant: Grant, target: Target): number {
  const scope = grant.scope;
  switch (scope.kind) {
    case "global": return 0;
    case "module": return scope.moduleId === target.moduleId ? 1 : -1;
    case "connector": return scope.connectorId === target.connectorId ? 1 : -1;
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
function chooseGrant(action: Action, target: Target, grants: readonly Grant[], now: Date): Grant | undefined {
  let chosen: Grant | undefined;
  let rank = -1;
  for (const grant of grants) {
    if (!isUsableGrant(grant, action, now)) continue;
    const next = specificity(grant, target);
    if (next < 0) continue;
    if (next > rank || (next === rank && chosen && MODE_STRICTNESS[grant.mode] > MODE_STRICTNESS[chosen.mode])) {
      chosen = grant;
      rank = next;
    }
  }
  return chosen;
}
export function decidePolicy(action: Action, target: Target, grants: readonly Grant[], now: Date): PolicyDecision {
  const fallback: GrantMode = DEFAULT_POLICY[action];
  const chosen = fallback === "never" ? undefined : chooseGrant(action, target, grants, now);
  const selected: GrantMode = chosen?.mode ?? fallback;
  const mode = selected === "preapproved" && !chosen ? "ask" : selected;
  return { action, mode, grantId: chosen?.id ?? null, reason: policyReason(action, mode, chosen) };
}

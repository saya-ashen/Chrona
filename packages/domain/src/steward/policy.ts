import { DEFAULT_POLICY, type Action, type Grant, type GrantMode, type PolicyDecision } from "@chrona/contracts/steward";

export const MODE_STRICTNESS = { auto: 0, notify_after: 1, preapproved: 2, ask: 3, never: 4 } as const satisfies Record<GrantMode, number>;
type Target = { affairId?: string; connectionId?: string; toolId?: string; toolVersion?: number };
const labels: Record<Action, string> = {
  read_source: "读取来源", web_research: "检索网页", write_chrona: "记录事务", set_care: "设置照看", enable_panel: "启用面板",
  run_script: "运行脚本", send_external_message: "对外发消息", modify_external: "修改外部系统", purchase: "购买",
  delete_data: "删除数据", connect_source: "接入来源", share_third_party: "向第三方分享", change_credentials: "修改凭据",
};
const modes: Record<GrantMode, string> = { auto: "可以直接做", notify_after: "做完告诉你", preapproved: "按授权执行", ask: "需要先问你", never: "留给你处理" };
function specificity(grant: Grant, target: Target): number {
  const scope = grant.scope;
  switch (scope.kind) {
    case "global": return 0;
    case "affair": return scope.affairId === target.affairId ? 1 : -1;
    case "connection": return scope.connectionId === target.connectionId ? 1 : -1;
    case "tool_version": return scope.toolId === target.toolId && scope.version === target.toolVersion ? 2 : -1;
  }
}
export function decidePolicy(action: Action, target: Target, grants: readonly Grant[], now: Date): PolicyDecision {
  const fallback: GrantMode = DEFAULT_POLICY[action];
  let chosen: Grant | undefined;
  let rank = -1;
  if (fallback !== "never") for (const grant of grants) {
    if (grant.action !== action || grant.revokedAt !== null || (grant.once && grant.consumedAt !== null)
      || (grant.expiresAt !== null && !(Date.parse(grant.expiresAt) > now.getTime()))) continue;
    const next = specificity(grant, target);
    if (next < 0) continue;
    if (next > rank || (next === rank && chosen && MODE_STRICTNESS[grant.mode] > MODE_STRICTNESS[chosen.mode])) {
      chosen = grant;
      rank = next;
    }
  }
  const selected: GrantMode = chosen?.mode ?? fallback;
  const mode = selected === "preapproved" && !chosen ? "ask" : selected;
  const prefix = !chosen ? "内置规则：" : chosen.scope.kind === "affair" ? "你在这件事里允许过：" : "你的授权规则：";
  return { action, mode, grantId: chosen?.id ?? null, reason: `${prefix}${labels[action]}${modes[mode]}` };
}

import { builder } from "./spec";

export type ModuleModel = { models: Record<string, string | { model: string; thinking?: string }>; maxCallsPerEvent: number; maxOutputTokens: number; dailyCalls: number; timeoutMs: number; moduleDailyCalls?: Record<string, number> };
export type GlobalSettings = {
  notifications: { dailyCap: number; quietHours: { start: string; end: string } | null; timezone: string; digestAt: string };
  builds: { dailyLimit: number; timeoutMinutes: number; maxSubmissions: number };
  buildUsage: { date: string; timezone: string; used: number; remaining: number };
  moduleModel?: ModuleModel | null;
  modelUsage?: { module: string; calls: number; inputTokens: number; outputTokens: number }[];
};
export type Grant = { id: string; action: string; mode: string; scope: { kind: string }; revokedAt?: string | null; once?: boolean; consumedAt?: string | null; expiresAt?: string | null };
export type Schedule = { id: string; label?: string; mode: string; status: string; nextAt?: string };
export type SettingsView = { settings: GlobalSettings; secrets?: { modules: string[]; configured: boolean }[]; schedules: Schedule[]; grants: Grant[]; preferences: { id: string; text: string }[] };
export const settingsData = { settingsView: { tool: "settings" }, apps: { tool: "modules" }, systemApps: { tool: "system-apps" } };
export const liveGrant = (grant: Grant, now = Date.now()) => !grant.revokedAt && !(grant.once && grant.consumedAt) && !(grant.expiresAt && Date.parse(grant.expiresAt) <= now);
export const scheduleActions = (schedule: Schedule) => [
  { label: schedule.status === "active" ? "暂停" : "恢复", tool: "schedule-update", args: { id: schedule.id, status: schedule.status === "active" ? "paused" : "active" } },
  { label: "取消", tool: "schedule-update", args: { id: schedule.id, status: "cancelled" }, confirm: "取消这个日程？" },
];
export function settingsSpec(state: Record<string, unknown>) {
  const b = builder(), view = state.settingsView as SettingsView | undefined;
  if (!view) return b.finish("设置", [b.text("加载中……", "muted")]);
  const { settings } = view, usage = settings.buildUsage, current = settings.moduleModel;
  const action = (props: Record<string, unknown>) => b.node("SystemAction", props);
  const section = (title: string, children: string[]) => b.node("Card", { title }, children);
  const needs = new Map((view.secrets ?? []).flatMap(secret => secret.modules.map(name => [name, secret.configured] as const)));
  const apps = (state.apps ?? []) as { id: string; name: string }[], system = (state.systemApps ?? []) as { name: string }[];
  const appLinks = [...apps.map(app => b.row([b.link(app.name, `/apps/${encodeURIComponent(app.id)}?tab=settings`), ...(!needs.get(app.name) && needs.has(app.name) ? [b.node("Badge", { text: "凭据未设置", variant: "destructive" })] : [])])), ...system.map(app => b.row([b.link(app.name, `/apps/system/${encodeURIComponent(app.name)}?tab=settings`), b.text("系统", "muted")]))];
  const schedules = view.schedules.filter(schedule => schedule.status === "active" || schedule.status === "paused");
  const spec = b.finish("设置", []);
  spec.elements[spec.root] = { type: "Stack", props: { gap: "md" }, children: [
    section("设置", [b.node("NotificationSettings", { settings })]),
    section("构建设置", [b.text(`${usage.date}（${usage.timezone}）：今日新建 ${usage.used} / ${settings.builds.dailyLimit}，剩余 ${usage.remaining} 个。`, "muted"),
      b.text("每日额度按上方时区的零点重置，只计算新建构建会话；手动续作仍受每会话每日24次、全局每日200次运行限制。设为0可暂停新建。", "muted"),
      b.text("修改只影响后续构建，不中断当前构建。失败不自动重试，启用应用仍需遵循审批。提高额度可能增加模型费用。", "muted"), b.node("BuildSettings", { settings })]),
    section("模块模型", [...(!current ? [b.text("尚未配置：模块不能调用模型。", "muted")] : []), b.node("ModuleModelSettings", { settings }), b.heading("今日用量"), b.list((settings.modelUsage ?? []).map(row => b.stack([b.text(`${row.module}：${row.calls} 次`), b.text(`输入 ${row.inputTokens} / 输出 ${row.outputTokens} token${current?.moduleDailyCalls?.[row.module] !== undefined ? ` · 上限 ${current.moduleDailyCalls[row.module]}` : ""}`, "muted")])), "今天还没有模块调用模型。")]),
    section("按应用设置", [b.text("每个应用自己的配置、凭据和模型上限在它的“设置”标签里。", "muted"), b.list(appLinks)]),
    section("日程", [b.list(schedules.map(schedule => b.stack([b.text(schedule.label ?? schedule.mode), ...(schedule.status === "paused" ? [b.text("已暂停", "muted")] : schedule.nextAt ? [b.time(schedule.nextAt)] : []), b.node("Stack", { direction: "horizontal", gap: "sm" }, scheduleActions(schedule).map(action))])), "没有日程。")]),
    section("授权规则", [b.list(view.grants.filter(grant => liveGrant(grant)).map(grant => b.stack([b.text(`${grant.action} · ${{ allow: "允许", ask: "先问我" }[grant.mode]}`), b.text(grant.scope.kind === "module" ? "仅一个应用" : "全部", "muted"), action({ label: "撤销", tool: "revoke", args: { id: grant.id }, confirm: "撤销这条授权？" })])), "没有授权规则。")]),
    section("Chrona 记得的偏好", [b.list(view.preferences.map(preference => b.stack([b.text(preference.text), action({ label: "删除", tool: "preference-forget", args: { id: preference.id }, confirm: "删除这条偏好？" })])), "还没有。")]),
  ] };
  return spec;
}

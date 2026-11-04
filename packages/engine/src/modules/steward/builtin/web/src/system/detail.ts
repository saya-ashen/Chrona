import { builder, type Builder } from "./spec";
import { runtimeText } from "./text";
import { diagnosticNodes } from "./diagnostics";
import type { ActivityItem } from "./activity";
import type { App, Diagnostics, Overview, Permissions, Tool } from "./detail-types";
export const APP_TABS = [["overview", "概览"], ["settings", "设置"], ["permissions", "权限"], ["activity", "活动"], ["versions", "版本"]];
export const SYSTEM_TABS = [["overview", "概览"], ["settings", "设置"], ["tools", "工具"], ["activity", "活动"]];
export const selectedTab = (tab: string, system = false, session = "") => session ? "overview" : (system ? SYSTEM_TABS : APP_TABS).some(([key]) => key === tab) ? tab : "overview";
export type DetailRoute = { id: string; tab: string; session: string };
export function detailData(route: DetailRoute, system: boolean) {
  const sources: Record<string, { tool: string; args?: Record<string, unknown> }> = { overview: { tool: "overview", args: { id: route.id } } };
  if (system) return sources;
  const tab = selectedTab(route.tab);
  if (tab === "overview") Object.assign(sources, { tools: { tool: "tools", args: { query: { $state: "/overview/app/name" } } }, pages: { tool: "pages" }, recent: { tool: "detail-activity", args: { module: { $state: "/overview/app/name" } } } });
  if (tab === "settings") sources.global = { tool: "settings" };
  if (tab === "activity") sources.diagnostics = { tool: "diagnostics", args: { id: route.id } };
  return sources;
}
function currentVersion(b: Builder, app: App, recent: ActivityItem[]) {
  const switched = recent.find(item => ["module_activate", "module_auto_activated", "module_rollback", "admin_rollback"].includes(String((item as ActivityItem & { kind?: string }).kind)));
  const rows = [b.heading(`当前版本 ${String(app.activeHash ?? "无").slice(0, 8)}`)];
  if (switched) rows.push(b.time(switched.at), b.text(switched.text));
  if (recent.length > 1) rows.push(b.list(recent.filter(item => item !== switched).slice(0, 5).map(item => b.stack([b.time(item.at), b.text(item.text)]))));
  rows.push(b.link("查看全部活动", `/activity?module=${encodeURIComponent(app.name)}`));
  return b.stack(rows);
}
function permissions(b: Builder, view: Permissions) {
  const status: Record<string, string> = { open: "待决定", approved: "已批准", denied: "已拒绝", expired: "已过期" };
  return [b.heading("能做什么"), b.list(view.capabilities.map(item => b.text(item)), "只在自己的数据里工作，不联网、不调用其他应用。"),
    b.heading("你给过的授权"), b.list(view.grants.map(grant => b.stack([b.text(`${grant.action} · ${grant.mode === "allow" ? "允许" : "先问我"}${grant.once ? " · 一次" : ""}`), b.node("SystemAction", { label: "撤销", tool: "revoke", args: { id: grant.id }, confirm: "撤销这条授权？" })]))),
    b.heading("最近审批"), b.list(view.approvals.map(item => b.stack([b.text(`${item.title} ${status[item.status] ?? item.status}`), b.time(item.createdAt)])))];
}
function appOverview(b: Builder, app: App, state: Record<string, unknown>) {
  const rows = [b.text(`${app.status === "active" ? "已启用" : "已暂停"} · ${runtimeText(app.health)}`)];
  if (app.description) rows.push(b.text(app.description));
  rows.push(currentVersion(b, app, (state.recent as ActivityItem[] | undefined) ?? []));
  const pages = (state.pages as { module: string; id: string; title: string }[] | undefined) ?? [];
  rows.push(...pages.filter(page => page.module === app.name).map(page => b.link(`打开${page.title}`, `/p/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}`)));
  const tools = ((state.tools as Tool[] | undefined) ?? []).filter(tool => tool.target.startsWith(`${app.name}.`));
  if (tools.length) rows.push(b.heading("操作", "h2"), ...tools.map(tool => b.node("ToolForm", { tool })));
  return rows;
}
function appSettings(b: Builder, app: App, view: Overview, state: Record<string, unknown>) {
  const rows = [b.heading("配置"), b.node("SettingsForm", { module: app.name, view: view.settings })];
  if (view.permissions.secrets.length) rows.push(b.heading("凭据"), b.text("只保存在 Chrona 本机，不会显示、不进入对话或模型。留空的字段保持原值。", "muted"), b.node("Credentials", { permissions: view.permissions, global: state.global }));
  if (view.permissions.model) rows.push(b.heading("模型"), b.node("ModelCap", { name: app.name, model: view.permissions.model }));
  return rows;
}
function appActivity(b: Builder, app: App, view: Overview, state: Record<string, unknown>) {
  return [b.activity(view.activity, app.name), b.heading("最近运行"), b.list(app.runs.map(run => b.stack([b.time(run.createdAt), b.text(`${run.triggerId} · ${run.error || (run.exitCode === 0 ? "成功" : `退出码 ${run.exitCode}`)}`, run.error ? "error" : undefined)])), "还没有运行记录。"), diagnosticNodes(b, state.diagnostics as Diagnostics | undefined, app.id, app.name)];
}
function appPanel(b: Builder, app: App, view: Overview, state: Record<string, unknown>, tab: string) {
  const panels: Record<string, () => string[]> = {
    overview: () => appOverview(b, app, state), settings: () => appSettings(b, app, view, state), permissions: () => permissions(b, view.permissions), activity: () => appActivity(b, app, view, state),
    versions: () => [b.list(app.versions.slice(0, 20).map(version => b.stack([b.time(version.createdAt), b.text(`${version.hash.slice(0, 8)} · ${version.hash === app.activeHash ? "当前" : version.status}`), ...(version.errors ? [b.text(version.errors.join("；"), "error")] : [])])))],
  };
  return panels[tab]!();
}
function systemPanel(b: Builder, view: Overview, route: DetailRoute, tab: string) {
  const panels: Record<string, () => string[]> = {
    overview: () => {
      const rows = [b.text(view.description)];
      if (route.id === "memory") rows.push(b.node("MemoryPanel", {}));
      if (view.sessions) rows.push(b.heading("最近的工作", "h2"), b.list(view.work.map(session => b.node("SessionWork", { session, open: session.id === route.session })), "还没有工作记录。"));
      return rows;
    },
    settings: () => [b.node("SettingsForm", { module: route.id, view: view.settings })],
    tools: () => [b.list(view.tools.map(tool => b.text(`${route.id}.${tool.name} ${tool.visibility.includes("provider") ? "Chrona" : tool.visibility.includes("modules") ? "其他应用" : "用户入口"}可调用 · ${tool.description}`)))],
    activity: () => [b.activity(view.activity, route.id)],
  };
  return panels[tab]!();
}
export function detailSpec(state: Record<string, unknown>, route: DetailRoute, system = false) {
  const b = builder(), view = state.overview as Overview | undefined;
  if (!view) return b.finish(system ? `${route.id} · 系统` : "应用", [b.text("加载中……", "muted")]);
  if (!system && !view.app) return b.finish("应用", [b.text("没有这个应用", "error")]);
  const tab = selectedTab(route.tab, system, system ? route.session : ""), app = view.app;
  const base = system ? `/apps/system/${encodeURIComponent(route.id)}` : `/apps/${encodeURIComponent(app!.id)}`;
  const rows = system ? [b.text("Chrona 自身的一部分：不能构建、更新或停用，随 Chrona 版本更新。", "muted")] : [];
  rows.push(b.node("TabNav", { items: (system ? SYSTEM_TABS : APP_TABS).map(([key, label]) => ({ label, href: `${base}?tab=${key}`, current: key === tab })) }));
  rows.push(...(system ? systemPanel(b, view, route, tab) : appPanel(b, app!, view, state, tab)));
  return b.finish(system ? `${route.id} · 系统` : app!.name, rows);
}

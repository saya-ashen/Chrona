import { builder, type Builder } from "./spec";
import { runtimeText } from "./text";
import { diagnosticNodes } from "./diagnostics";
import type { ActivityItem } from "./activity";
import type { App, Diagnostics, Overview, Permissions, Tool } from "./detail-types";
import type { ModuleInstallResult } from "@chrona/contracts/steward";
import { installationText } from "./install";
export const APP_TABS = [["overview", "概览"], ["settings", "设置"], ["permissions", "权限"], ["activity", "活动"], ["versions", "版本"]];
export const SYSTEM_TABS = [["overview", "概览"], ["settings", "设置"], ["tools", "工具"], ["activity", "活动"]];
export const selectedTab = (tab: string, system = false, session = "") => session ? "overview" : (system ? SYSTEM_TABS : APP_TABS).some(([key]) => key === tab) ? tab : "overview";
export type DetailRoute = { id: string; tab: string; session: string };
export function detailData(route: DetailRoute, system: boolean) {
  const sources: Record<string, { tool: string; args?: Record<string, unknown>; refresh?: number }> = { overview: { tool: "overview", args: { id: route.id }, refresh: 5 } };
  if (system) return sources;
  sources.catalog = { tool: "catalog", refresh: 5 };
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
function appControls(b: Builder, app: App) {
  const rows: string[] = [];
  if (app.activeHash && (app.status === "active" && app.capabilities.disable || app.status === "paused" && app.capabilities.enable)) {
    const paused = app.status === "paused", label = paused ? "恢复" : "暂停";
    rows.push(b.node("SystemAction", { label, tool: paused ? "module-enable" : "module-disable", args: { id: app.name }, confirm: paused ? `恢复 ${app.name}？应用及随暂停停止的日程将恢复运行。` : `暂停 ${app.name}？应用和它的日程会停止，数据和文件会保留。` }));
  }
  if (app.activeHash && app.capabilities.remove && app.status !== "migrating") rows.push(b.node("AppRemoval", { name: app.name }));
  return rows;
}
function installationNodes(b: Builder, installation: ModuleInstallResult | null | undefined) {
  if (!installation) return [];
  const rows = [b.text(installationText(installation.status))];
  if (installation.error) rows.push(b.text(installation.error.message, "error"));
  if (installation.approvalId) rows.push(b.link("前往待你决定", "/"));
  if (["failed", "unavailable"].includes(installation.status)) rows.push(b.link("查看安装状态并明确重试", "/apps"));
  return rows;
}
function appResources(b: Builder, app: App, state: Record<string, unknown>) {
  const pages = (state.pages as { module: string; id: string; title: string }[] | undefined) ?? [];
  const rows = pages.filter(page => page.module === app.name).map(page => b.link(`打开${page.title}`, `/p/${encodeURIComponent(page.module)}/${encodeURIComponent(page.id)}`));
  const tools = ((state.tools as Tool[] | undefined) ?? []).filter(tool => tool.target.startsWith(`${app.name}.`));
  if (tools.length) rows.push(b.heading("操作", "h2"), ...tools.map(tool => b.node("ToolForm", { tool })));
  return rows;
}
function appOverview(b: Builder, app: App, state: Record<string, unknown>) {
  const statuses: Record<string, string> = { active: app.activeHash ? "已启用" : "尚未启用", paused: "已暂停", migrating: "数据处理中" };
  const status = statuses[app.status] ?? app.status;
  const missing = (state.overview as Overview).permissions.secrets.some(secret => !secret.configured);
  const rows = [b.text(`${app.origin === "builtin" ? "内置" : "外置"} · ${status} · ${missing ? "待配置 · " : ""}${runtimeText(app.health)}`)];
  const installation = (state.catalog as { moduleId: string | null; installation: ModuleInstallResult | null }[] | undefined)?.find(item => item.moduleId === app.id)?.installation;
  rows.push(...installationNodes(b, installation));
  if (missing) rows.push(b.link("完成凭据配置", `/apps/${encodeURIComponent(app.id)}?tab=settings`));
  if (app.origin === "builtin") rows.push(b.text("代码随 Chrona 发版更新；可查看状态、配置和诊断。", "muted"));
  if (app.capabilities.build) rows.push(b.link("向 Chrona 交代外置应用的构建需求", "/chat/new"), b.text("在对话中明确应用与需求，由 Chrona 使用获准的构建接口处理。", "muted"));
  if (app.description) rows.push(b.text(app.description));
  rows.push(...appControls(b, app), currentVersion(b, app, (state.recent as ActivityItem[] | undefined) ?? []));
  rows.push(...appResources(b, app, state));
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
    versions: () => [b.list(app.versions.slice(0, 20).map(version => b.stack([b.time(version.createdAt), b.text(`${version.hash.slice(0, 8)} · ${version.hash === app.activeHash ? "当前" : version.status}`), ...(version.errors ? [b.text(version.errors.join("；"), "error")] : []),
      ...(app.capabilities.rollback && version.status === "approved" && version.hash !== app.activeHash ? [b.node("SystemAction", { label: "回滚到此版本", tool: "module-rollback", args: { id: app.name, hash: version.hash }, confirm: `回滚 ${app.name} 到 ${version.hash.slice(0, 8)}？如需恢复数据，会另行请你确认。` })] : [])])), "还没有版本记录。")],
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
const detailTabs = (system: boolean, app: App | null | undefined) => system ? SYSTEM_TABS : APP_TABS.filter(([key]) => key !== "versions" || app!.origin === "external");
export function detailSpec(state: Record<string, unknown>, route: DetailRoute, system = false) {
  const b = builder(), view = state.overview as Overview | undefined;
  if (!view) return b.finish(system ? `${route.id} · 系统` : "应用", [b.text("加载中……", "muted")]);
  if (!system && !view.app) return b.finish("应用", [b.text("没有这个应用", "error")]);
  const tab = selectedTab(route.tab, system, system ? route.session : ""), app = view.app;
  const base = `/apps/${system ? `system/${encodeURIComponent(route.id)}` : encodeURIComponent(app!.id)}`;
  const rows = system ? [b.text("Chrona 自身的一部分：不能构建、更新或停用，随 Chrona 版本更新。", "muted")] : [];
  const tabs = detailTabs(system, app);
  const currentTab = tabs.some(([key]) => key === tab) ? tab : "overview";
  rows.push(b.node("TabNav", { items: tabs.map(([key, label]) => ({ label, href: `${base}?tab=${key}`, current: key === currentTab })) }));
  rows.push(...(system ? systemPanel(b, view, route, tab) : appPanel(b, app!, view, state, currentTab)));
  return b.finish(system ? `${route.id} · 系统` : app!.name, rows);
}

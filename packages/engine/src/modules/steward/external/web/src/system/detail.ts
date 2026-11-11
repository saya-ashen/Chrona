import { builder, type Builder } from "./spec";
import { pageHref, settingsHref, pagesForApp, settingsPageForApp, settingsUnavailable, type RegisteredPage } from "./registered-pages";
import { runtimeText } from "./text";
import { diagnosticNodes } from "./diagnostics";
import type { ActivityItem } from "./activity";
import type { App, Diagnostics, Overview, Tool } from "./detail-types";
import { runtimeCapabilityText, runtimeCapabilityBoundary } from "./runtime";

export const APP_TABS = [["overview", "概览"], ["settings", "设置"], ["tools", "工具（高级）"], ["activity", "活动"], ["versions", "版本"]];
export const SYSTEM_TABS = [["overview", "概览"], ["tools", "工具"], ["activity", "活动"]];
export const selectedTab = (tab: string, system = false, session = "") => session ? "overview" : (system ? SYSTEM_TABS : APP_TABS).some(([key]) => key === tab) ? tab : "overview";
export type DetailRoute = { id: string; tab: string; session: string };
export function detailData(route: DetailRoute, system: boolean) {
  const sources: Record<string, { tool: string; args?: Record<string, unknown>; refresh?: number }> = { overview: { tool: "overview", args: { id: route.id }, refresh: 5 } };
  const tab = selectedTab(route.tab, system);
  const module = system ? route.id : { $state: "/overview/app/name" };
  if (!system) sources.pages = { tool: "pages", refresh: 5 };
  if (tab === "tools") {
    sources.tools = { tool: "tools", args: { query: module } };
    if (!system) sources.userTools = { tool: "tools", args: { query: module, audience: "user" } };
  }
  if (tab === "overview") {
    if (system && route.id === "modules") sources.authorTools = { tool: "tools", args: { query: "author", audience: "user" } };
  }
  if (tab === "activity") {
    sources.recent = { tool: "detail-activity", args: { module } };
    if (!system) sources.diagnostics = { tool: "diagnostics", args: { id: route.id } };
  }
  return sources;
}
/** Search also matches descriptions; a neighboring module must never supply this page's contracts. */
export const toolsForModule = (tools: Tool[] | undefined, name: string) => (tools ?? []).filter(tool => tool.target.startsWith(`${name}.`));
function contracts(b: Builder, state: Record<string, unknown>, name: string, system: boolean) {
  const declared = state.tools as Tool[] | undefined;
  if (!declared) return [b.text("正在读取可发现的工具合同……", "muted")];
  const tools = toolsForModule(declared, name);
  const rows = [b.text("这里只展示当前可发现的合同；能否执行由调用时的权限和模块状态决定。", "muted")];
  if (!system && !state.userTools) rows.push(b.text("正在读取用户操作……", "muted"));
  // A second discovery uses the user audience. The Web module's own visibility is not user authority.
  const userTargets = new Set(toolsForModule(state.userTools as Tool[] | undefined, name).map(tool => tool.target));
  rows.push(b.list(tools.map(tool => b.stack([
    b.node("ToolContract", { tool }),
    ...(!system && userTargets.has(tool.target) ? [b.node("ToolForm", { tool })] : []),
  ])), "当前没有可发现的工具。"));
  return rows;
}
function authoring(b: Builder, state: Record<string, unknown>) {
  const rows = [b.heading("模块创作", "h2"), b.text("自动模型创作暂不可用。普通 author 模块可通过准备、写入、读取、列出文件、查看源码、提交和回执工具处理创作材料。", "muted")];
  const author = toolsForModule(state.authorTools as Tool[] | undefined, "author");
  if (author.length) rows.push(b.link("打开 author 模块工具", `/apps/${encodeURIComponent(author[0]!.moduleId ?? "author")}?tab=tools`));
  else rows.push(b.text(state.authorTools ? "当前没有可用的 author 用户工具。" : "正在查找 author 工具……", "muted"));
  return rows;
}
function appOverview(b: Builder, app: App, state: Record<string, unknown>) {
  const statuses: Record<string, string> = { active: app.activeHash ? "已启用" : "尚未启用", paused: "已暂停", migrating: "数据处理中" };
  const rows = [b.text(`${app.origin === "builtin" ? "内置" : "外置"} · ${statuses[app.status] ?? app.status} · ${runtimeText(app.health)}`)];
  if (app.origin === "builtin" && !app.capabilities.update) rows.push(b.text("受保护模块，代码随 Chrona 发版更新；可查看状态、工具合同和诊断。", "muted"));
  if (app.description) rows.push(b.text(app.description));
  rows.push(b.heading(`当前版本 ${String(app.activeHash || "无").slice(0, 8)}`), b.link("查看全部活动", `/activity?module=${encodeURIComponent(app.name)}`));
  const pages = state.pages as RegisteredPage[] | undefined;
  const settingsPage = settingsPageForApp(pages, app);
  rows.push(settingsPage ? b.link("打开设置", settingsHref(app.id)) : b.text(settingsUnavailable(pages, app), "muted"));
  rows.push(...pagesForApp(pages, app).filter(page => page.purpose !== "settings").map(page => b.link(`打开${page.title}`, pageHref(page))));
  rows.push(b.text("更多操作可在工具（高级）中查看。", "muted"));
  return rows;
}
function appPanel(b: Builder, app: App, state: Record<string, unknown>, tab: string) {
  if (tab === "settings") {
    const pages = state.pages as RegisteredPage[] | undefined, page = settingsPageForApp(pages, app);
    return [page ? b.node("AppSettings", { ...page, activeHash: app.activeHash }) : b.text(settingsUnavailable(pages, app), "muted")];
  }
  if (tab === "tools") return contracts(b, state, app.name, false);
  if (tab === "activity") return [state.recent ? b.activity(state.recent as ActivityItem[], app.name) : b.text("正在读取活动……", "muted"), b.heading("最近运行"), b.list(app.runs.map(run => b.stack([
    b.time(run.createdAt), b.text(`${run.triggerId} · ${run.error || (run.exitCode === null ? "尚无退出结果" : run.exitCode === 0 ? "成功" : `退出码 ${run.exitCode}`)}`, run.error ? "error" : undefined),
  ])), "还没有运行记录。"), diagnosticNodes(b, state.diagnostics as Diagnostics | undefined, app.id, app.name)];
  if (tab === "versions") return [b.list(app.versions.slice(0, 20).map(version => b.stack([
    b.time(version.createdAt), b.text(`${version.hash.slice(0, 8)} · ${version.hash === app.activeHash ? "当前" : version.status}`),
    ...(version.errors ? [b.text(version.errors.join("；"), "error")] : []),
    ...(app.capabilities.rollback && app.status !== "migrating" && app.activeHash && version.status === "approved" && version.hash !== app.activeHash ? [b.node("SystemAction", { label: "回滚到此版本", tool: "module-rollback", args: { id: app.id, hash: version.hash }, confirm: `回滚 ${app.name} 到 ${version.hash.slice(0, 8)}？如需恢复数据，会另行请你确认。` })] : []),
  ])), "还没有版本记录。")];
  return appOverview(b, app, state);
}
function systemPanel(b: Builder, view: Overview, route: DetailRoute, state: Record<string, unknown>, tab: string) {
  if (tab === "tools") return contracts(b, state, route.id, true);
  if (tab === "activity") return [state.recent ? b.activity(state.recent as ActivityItem[], route.id) : b.text("正在读取活动……", "muted")];
  const rows = view.runtime ? [b.text(view.runtime.responsibility), b.text(runtimeCapabilityText(view.runtime)), b.text(view.runtime.configuration)] : [b.text(view.description ?? "")];
  if (route.id === "memory") rows.push(b.node("MemoryPanel", {}));
  if (route.id === "modules") rows.push(...authoring(b, state));
  if (route.id === "agent") rows.push(b.link("打开内核预算设置", "/settings"));
  return rows;
}
const detailTabs = (system: boolean, app: App | undefined) => system ? SYSTEM_TABS : APP_TABS.filter(([key]) => key !== "versions" || app!.origin === "external" || app!.capabilities.update || app!.capabilities.rollback);
function detailNavigation(b: Builder, route: DetailRoute, system: boolean, app: App | undefined) {
  const tab = selectedTab(route.tab, system, system ? route.session : "");
  const tabs = detailTabs(system, app), currentTab = tabs.some(([key]) => key === tab) ? tab : "overview";
  const base = `/apps/${system ? `system/${encodeURIComponent(route.id)}` : encodeURIComponent(app!.id)}`;
  return { currentTab, navigation: b.node("TabNav", { items: tabs.map(([key, label]) => ({ label, href: `${base}?tab=${key}`, current: key === currentTab })) }) };
}
export function detailSpec(state: Record<string, unknown>, route: DetailRoute, system = false) {
  const b = builder(), view = state.overview as Overview | undefined, title = `${route.id} · 内核`;
  if (!view) return b.finish(system ? title : "模块", [b.text("加载中……", "muted")]);
  if (!system && !view.app) return b.finish("应用", [b.text("没有这个应用", "error")]);
  const app = view.app;
  const rows = system ? [b.text(`内核接口，随 Chrona 版本更新。${view.runtime ? runtimeCapabilityBoundary : "在此查看合同与运行记录。"}`, "muted")] : [];
  const { currentTab, navigation } = detailNavigation(b, route, system, app);
  rows.push(navigation);
  rows.push(...(system ? systemPanel(b, view, route, state, currentTab) : appPanel(b, app!, state, currentTab)));
  return b.finish(system ? title : app!.name, rows);
}

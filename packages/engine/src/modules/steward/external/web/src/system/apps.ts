import type { Spec } from "@json-render/core";
import { faultText, runtimeText } from "./text";
import type { App, RuntimeCapability } from "./detail-types";
import { runtimeCapabilityText } from "./runtime";

type ListedApp = App & { health: App["health"] & { incident?: { status: string } | null } };
type SystemApp = { name: string; description: string; runtime?: RuntimeCapability };
export const appsData = { apps: { tool: "modules", refresh: 5 }, systemApps: { tool: "system-apps" },  };
type Node = (type: string, props: Record<string, unknown>, children?: string[]) => string;
function appControls(node: Node, app: ListedApp) {
  const rows: string[] = [];
  if (app.activeHash && (app.status === "active" && app.capabilities.disable || app.status === "paused" && app.capabilities.enable)) {
    const paused = app.status === "paused", label = paused ? "恢复" : "暂停";
    rows.push(node("SystemAction", { label, tool: paused ? "module-enable" : "module-disable", args: { id: app.id }, confirm: paused ? `恢复 ${app.name}？应用及随暂停停止的日程将恢复运行。` : `暂停 ${app.name}？应用和它的日程会停止，数据和文件会保留。` }));
  }
  if (app.activeHash && app.capabilities.remove && app.status !== "migrating") rows.push(node("AppRemoval", { moduleId: app.id, name: app.name }));
  return rows;
}
function appDescription(app: ListedApp) {
  const protection = !app.capabilities.remove ? "当前不可删除。" : "";
  return `${app.origin === "builtin" ? "内置" : "外置"} · ${protection}${!app.activeHash ? "尚未启用 · " : ""}${runtimeText(app.health)} · ${app.health.incident ? `${faultText(app.health.incident.status)} · ` : ""}${app.description ?? ""}`;
}
function appRow(node: Node, app: ListedApp) {
  return node("Stack", { gap: "sm" }, [
    node("Stack", { direction: "horizontal", gap: "sm", align: "center" }, [node("Link", { label: app.name, href: `/apps/${encodeURIComponent(app.id)}` }), ...appControls(node, app)]),
    node("Text", { text: appDescription(app), variant: "muted" }),
  ]);
}
function moduleSection(node: Node, apps: ListedApp[]) {
  const rows = apps.map(app => appRow(node, app));
  return node("Card", { title: "模块", description: "已安装的模块统一在这里管理；预装不增加权限。可用操作以各模块权限和当前状态为准，删除需要确认。" },
    rows.length ? [node("List", {}, rows)] : [node("Text", { text: "还没有已安装的模块。" })]);
}
function kernelSection(node: Node, apps: SystemApp[]) {
  const rows = apps.map(app => node("Stack", { gap: "sm" }, [
    node("Link", { label: app.name, href: `/apps/system/${encodeURIComponent(app.name)}` }),
    node("Text", { text: app.description, variant: "muted" }),
    ...(app.runtime ? [node("Text", { text: runtimeCapabilityText(app.runtime), variant: "muted" }), node("Text", { text: app.runtime.responsibility, variant: "muted" })] : []),
  ]));
  return node("Card", { title: "内核", description: "Chrona 的系统接口与本机运行信息，不属于可安装或删除的模块。" }, rows.length ? [node("List", {}, rows)] : [node("Text", { text: "当前没有已登记的内核接口。" })]);
}
export function appsSpec(state: Record<string, unknown>): Spec {
  const elements: Spec["elements"] = {};
  let serial = 0;
  const node = (type: string, props: Record<string, unknown>, children: string[] = []) => { const id = `n${serial++}`; elements[id] = { type, props, children }; return id; };
  const apps = state.apps as ListedApp[] | undefined, system = state.systemApps as SystemApp[] | undefined;
  if (!apps || !system) return { root: node("Spinner", { label: "加载中……" }), elements };
  return { root: node("Stack", { gap: "lg" }, [kernelSection(node, system), moduleSection(node, apps)]), elements };
}

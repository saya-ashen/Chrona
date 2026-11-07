import type { Spec } from "@json-render/core";
import type { z } from "zod";
import type { modulePackageCatalogSchema } from "@chrona/contracts/steward";
import { faultText, runtimeText, readinessText } from "./text";
import { installationText } from "./install";
import type { App, RuntimeCapability } from "./detail-types";
import { runtimeCapabilityText, runtimeCapabilityBoundary } from "./runtime";

type ListedApp = App & { health: App["health"] & { incident?: { status: string } | null } };
type SystemApp = { name: string; description: string; runtime?: RuntimeCapability };
type Catalog = z.infer<typeof modulePackageCatalogSchema>;
type Credential = { modules: string[]; configured: boolean };
export const appsData = { apps: { tool: "modules", refresh: 5 }, systemApps: { tool: "system-apps" }, catalog: { tool: "catalog", refresh: 5 }, credentials: { tool: "credentials", refresh: 5 } };
type Node = (type: string, props: Record<string, unknown>, children?: string[]) => string;
function appControls(node: Node, app: ListedApp) {
  const rows: string[] = [];
  if (app.activeHash && (app.status === "active" && app.capabilities.disable || app.status === "paused" && app.capabilities.enable)) {
    const paused = app.status === "paused", label = paused ? "恢复" : "暂停";
    rows.push(node("SystemAction", { label, tool: paused ? "module-enable" : "module-disable", args: { id: app.name }, confirm: paused ? `恢复 ${app.name}？应用及随暂停停止的日程将恢复运行。` : `暂停 ${app.name}？应用和它的日程会停止，数据和文件会保留。` }));
  }
  if (app.activeHash && app.capabilities.remove && app.status !== "migrating") rows.push(node("AppRemoval", { name: app.name }));
  return rows;
}
function installAction(node: Node, item: Catalog[number], app: ListedApp | undefined, waiting: boolean, retry: boolean) {
  const canUpdate = !!app?.capabilities.update && app.activeHash !== item.releaseHash;
  if (!item.available || waiting || (item.moduleId && !canUpdate && !retry)) return [];
  const receipt = item.installation;
  return [node("PackageInstall", { name: item.name, mode: item.moduleId ? "update" : "install", retry, completedRequestKey: receipt && ["installed", "failed", "unavailable"].includes(receipt.status) ? receipt.requestKey : undefined })];
}
function packageActions(node: Node, item: Catalog[number], app: ListedApp | undefined) {
  const receipt = item.installation, waiting = !!receipt && ["pending", "building", "pending_approval"].includes(receipt.status);
  const retry = !!receipt && ["failed", "unavailable"].includes(receipt.status), rows: string[] = [];
  if (waiting) rows.push(node("Text", { text: "等待现有请求完成，刷新查看状态；不会自动重试。" }));
  if (receipt?.approvalId) rows.push(node("Link", { label: "前往待你决定", href: "/" }));
  if (app) rows.push(node("Link", { label: "配置与状态", href: `/apps/${encodeURIComponent(app.id)}?tab=settings` }));
  rows.push(...installAction(node, item, app, waiting, retry));
  return rows;
}
function packageRow(node: Node, item: Catalog[number], apps: ListedApp[]) {
  const receipt = item.installation;
  const description = `${item.description ?? ""} · ${item.moduleId ? "已有应用记录" : "未安装"}${receipt ? ` · 最近请求：${installationText(receipt.status)}` : ""}`;
  const rows = [node("Stack", { direction: "horizontal", gap: "sm", align: "center" }, [node("Text", { text: item.name }), ...packageActions(node, item, apps.find(app => app.id === item.moduleId))]),
    node("Text", { text: description, variant: "muted" })];
  if (item.error || receipt?.error) rows.push(node("Alert", { title: "需要处理", message: item.error ?? receipt?.error?.message, type: "error" }));
  if (!item.available) rows.push(node("Text", { text: "发行资源不可用，请检查 Chrona 安装。", variant: "muted" }));
  return node("Stack", { gap: "sm" }, rows);
}
function appDescription(app: ListedApp, credentials: Credential[] | undefined) {
  const configuration = credentials?.some(secret => secret.modules.includes(app.name) && !secret.configured) ? "待配置 · " : "";
  const protection = app.origin === "external" && !app.capabilities.remove ? "受保护的入口应用，不能删除。" : "";
  return `${app.origin === "builtin" ? "内置" : "外置"} · ${protection}${configuration}${!app.activeHash ? "尚未启用 · " : ""}${runtimeText(app.health)} · ${readinessText(app.health)} · ${app.health.incident ? `${faultText(app.health.incident.status)} · ` : ""}${app.description ?? ""}`;
}
function appRow(node: Node, app: ListedApp, catalog: Catalog | undefined, credentials: Credential[] | undefined) {
  const item = catalog?.find(item => item.moduleId === app.id), receipt = item?.installation;
  const actions = [...(item ? packageActions(node, item, app) : []), ...appControls(node, app)];
  const rows = [node("Stack", { direction: "horizontal", gap: "sm", align: "center" }, [node("Link", { label: app.name, href: `/apps/${encodeURIComponent(app.id)}` }), ...actions]),
    node("Text", { text: appDescription(app, credentials), variant: "muted" })];
  if (receipt) rows.push(node("Text", { text: `最近请求：${installationText(receipt.status)}`, variant: "muted" }));
  const error = item?.error ?? receipt?.error?.message;
  if (error) rows.push(node("Alert", { title: "需要处理", message: error, type: "error" }));
  return node("Stack", { gap: "sm" }, rows);
}
function installedSection(node: Node, apps: ListedApp[], origin: "external" | "builtin", catalog: Catalog | undefined, credentials: Credential[] | undefined) {
  const rows = apps.filter(app => app.origin === origin).map(app => appRow(node, app, catalog, credentials));
  const external = origin === "external";
  return node("Card", { title: external ? "外置应用" : "内置应用", description: external ? "可单独安装和更新；默认预装的应用也属于外置应用。删除需要确认。" : "Chrona 自带的基础应用，不能删除。" },
    rows.length ? [node("List", {}, rows)] : [node("Text", { text: external ? "还没有外置应用，可从下面的官方应用中安装。" : "当前没有内置应用。" })]);
}
function runtimeSection(node: Node, apps: SystemApp[]) {
  const rows = apps.filter(app => app.runtime).map(app => node("Stack", { gap: "sm" }, [
    node("Link", { label: app.name, href: `/apps/system/${encodeURIComponent(app.name)}` }),
    node("Text", { text: runtimeCapabilityText(app.runtime!), variant: "muted" }),
    node("Text", { text: app.runtime!.responsibility, variant: "muted" }),
  ]));
  return node("Card", { title: "运行能力", description: runtimeCapabilityBoundary }, rows.length ? [node("List", {}, rows)] : [node("Text", { text: "当前没有已登记的运行能力。" })]);
}
export function appsSpec(state: Record<string, unknown>): Spec {
  const elements: Spec["elements"] = {};
  let serial = 0;
  const node = (type: string, props: Record<string, unknown>, children: string[] = []) => { const id = `n${serial++}`; elements[id] = { type, props, children }; return id; };
  const apps = state.apps as ListedApp[] | undefined, system = state.systemApps as SystemApp[] | undefined, catalog = state.catalog as Catalog | undefined, credentials = state.credentials as Credential[] | undefined;
  if (!apps || !system) return { root: node("Spinner", { label: "加载中……" }), elements };
  const row = (label: string, href: string, description: string) => node("Stack", { gap: "sm" }, [node("Link", { label, href }), node("Text", { text: description, variant: "muted" })]);
  const sections = [installedSection(node, apps, "external", catalog, credentials)];
  const packages = catalog?.filter(item => !apps.some(app => app.id === item.moduleId)).map(item => packageRow(node, item, apps));
  sections.push(node("Card", { title: "可安装的官方外置应用", description: "安装由你明确选择；已安装应用的更新和管理按钮在上方。代码安装后，可能仍需配置凭据。" }, packages ? packages.length ? [node("List", {}, packages)] : [node("Text", { text: "当前没有可安装的官方应用。" })] : [node("Spinner", { label: "读取安装目录……" })]));
  sections.push(installedSection(node, apps, "builtin", catalog, credentials));
  sections.push(runtimeSection(node, system));
  const kernel = system.filter(app => !app.runtime);
  if (kernel.length) sections.push(node("Card", { title: "内核接口", description: "Chrona 的系统能力，不属于可安装或删除的应用。" }, [node("List", {}, kernel.map(app => row(app.name, `/apps/system/${encodeURIComponent(app.name)}`, app.description)))]));
  return { root: node("Stack", { gap: "lg" }, sections), elements };
}

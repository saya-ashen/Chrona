import type { Spec } from "@json-render/core";
import type { z } from "zod";
import type { modulePackageCatalogSchema } from "@chrona/contracts/steward";
import { faultText, runtimeText } from "./text";
import { installationText } from "./install";
import type { App } from "./detail-types";

type ListedApp = App & { health: App["health"] & { incident?: { status: string } | null } };
type SystemApp = { name: string; description: string };
type Catalog = z.infer<typeof modulePackageCatalogSchema>;
type Credential = { modules: string[]; configured: boolean };
export const appsData = { apps: { tool: "modules", refresh: 5 }, systemApps: { tool: "system-apps" }, catalog: { tool: "catalog", refresh: 5 }, credentials: { tool: "credentials", refresh: 5 } };
type Node = (type: string, props: Record<string, unknown>, children?: string[]) => string;
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
  const rows = [node("Text", { text: item.name }), node("Text", { text: description, variant: "muted" })];
  if (item.error || receipt?.error) rows.push(node("Alert", { title: "需要处理", message: item.error ?? receipt?.error?.message, type: "error" }));
  rows.push(...packageActions(node, item, apps.find(app => app.id === item.moduleId)));
  if (!item.available) rows.push(node("Text", { text: "发行资源不可用，请检查 Chrona 安装。", variant: "muted" }));
  return node("Stack", { gap: "sm" }, rows);
}
export function appsSpec(state: Record<string, unknown>): Spec {
  const elements: Spec["elements"] = {};
  let serial = 0;
  const node = (type: string, props: Record<string, unknown>, children: string[] = []) => { const id = `n${serial++}`; elements[id] = { type, props, children }; return id; };
  const apps = state.apps as ListedApp[] | undefined, system = state.systemApps as SystemApp[] | undefined, catalog = state.catalog as Catalog | undefined, credentials = state.credentials as Credential[] | undefined;
  if (!apps || !system) return { root: node("Spinner", { label: "加载中……" }), elements };
  const row = (label: string, href: string, description: string) => node("Stack", { gap: "sm" }, [node("Link", { label, href }), node("Text", { text: description, variant: "muted" })]);
  const appRows = apps.map(app => {
    const configuration = credentials?.some(secret => secret.modules.includes(app.name) && !secret.configured) ? "待配置 · " : "";
    return row(app.name, `/apps/${encodeURIComponent(app.id)}`, `${app.origin === "builtin" ? "内置" : "外置"} · ${configuration}${!app.activeHash ? "尚未启用 · " : ""}${runtimeText(app.health)} · ${app.health.incident ? `${faultText(app.health.incident.status)} · ` : ""}${app.description ?? ""}`);
  });
  const sections = [node("Card", { title: "应用" }, appRows.length ? [node("List", {}, appRows)] : [node("Text", { text: "还没有应用，可从下面的官方应用中安装。" })])];
  const packages = catalog?.map(item => packageRow(node, item, apps));
  sections.push(node("Card", { title: "官方外置应用", description: "安装和更新由你明确选择，不会覆盖已有定制。代码安装后，可能仍需配置凭据。" }, packages ? packages.length ? [node("List", {}, packages)] : [node("Text", { text: "当前没有可安装的官方应用。" })] : [node("Spinner", { label: "读取安装目录……" })]));
  if (system.length) sections.push(node("Card", { title: "内核", description: "Chrona 自身的一部分，随 Chrona 版本更新。" }, [node("List", {}, system.map(app => row(app.name, `/apps/system/${encodeURIComponent(app.name)}`, app.description)))]));
  return { root: node("Stack", { gap: "lg" }, sections), elements };
}

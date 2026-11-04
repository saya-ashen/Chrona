import type { Spec } from "@json-render/core";
import { faultText, runtimeText } from "./text";

type App = { id: string; name: string; builtin?: boolean; description?: string; health: { runtime?: { state: string }; incident?: { status: string } | null } };
type SystemApp = { name: string; description: string };
export const appsData = { apps: { tool: "modules" }, systemApps: { tool: "system-apps" } };
export function appsSpec(state: Record<string, unknown>): Spec {
  const elements: Spec["elements"] = {};
  let serial = 0;
  const node = (type: string, props: Record<string, unknown>, children: string[] = []) => { const id = `n${serial++}`; elements[id] = { type, props, children }; return id; };
  const apps = state.apps as App[] | undefined, system = state.systemApps as SystemApp[] | undefined;
  if (!apps || !system) return { root: node("Spinner", { label: "加载中……" }), elements };
  const row = (label: string, href: string, description: string) => node("Stack", { gap: "sm" }, [node("Link", { label, href }), node("Text", { text: description, variant: "muted" })]);
  const sections = [node("Card", { title: "应用" }, [node("List", {}, apps.map(app => row(app.name, `/apps/${encodeURIComponent(app.id)}`, `${runtimeText(app.health)} · ${app.health.incident ? `${faultText(app.health.incident.status)} · ` : ""}${app.builtin ? "内置 · " : ""}${app.description ?? ""}`)))])];
  if (system.length) sections.push(node("Card", { title: "系统", description: "Chrona 自身的一部分，随 Chrona 版本更新，只能查看。" }, [node("List", {}, system.map(app => row(app.name, `/apps/system/${encodeURIComponent(app.name)}`, app.description)))]));
  return { root: node("Stack", { gap: "lg" }, sections), elements };
}

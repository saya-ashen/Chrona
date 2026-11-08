import type { Spec } from "@json-render/core";

export type ActivityItem = { id: string; at: string; module: string | null; text: string; session?: { id: string; source: string } };
export type ActivityPage = { items: ActivityItem[]; before: string | null };
export const activityData = (module: string) => ({ activity: { tool: "activity", args: { module } } });
export function activitySpec(state: Record<string, unknown>, module = ""): Spec {
  const elements: Spec["elements"] = {};
  let serial = 0;
  const node = (type: string, props: Record<string, unknown>, children: string[] = [], id = `n${serial++}`) => { elements[id] = { type, props, children }; return id; };
  const link = (label: string, href: string) => node("Link", { label, href });
  const page = state.activity as ActivityPage | undefined;
  const children = [node("Text", { text: "Chrona 做过的事：审批与你的决定、应用的检查、启用、自动更新、回滚和故障、授权、设置与凭据的改动（只记名称）。", variant: "muted" })];
  if (module) children.push(link("看全部应用", "/activity"));
  if (!page) children.push(node("Spinner", { label: "加载中……" }));
  else {
    children.push(page.items.length ? node("List", {}, page.items.map(item => {
      const parts = [node("Time", { value: item.at })];
      if (item.module && !module) parts.push(link(item.module, `/activity?module=${encodeURIComponent(item.module)}`));
      parts.push(node("Text", { text: item.text }));
      if (item.session) parts.push(link("查看过程", item.session.source === "build" ? `/sessions/${item.session.id}` : `/apps/system/${encodeURIComponent(String(item.module))}?session=${encodeURIComponent(item.session.id)}`));
      return node("Stack", { direction: "horizontal", gap: "sm", align: "center" }, parts, `activity-${item.id}`);
    })) : node("Text", { text: "还没有活动。", variant: "muted" }));
    if (page.before) children.push(node("ActivityMore", { module }));
  }
  return { root: node("Card", { title: module ? `活动 · ${module}` : "活动" }, children, "activity"), elements };
}

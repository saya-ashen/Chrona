import type { Spec } from "@json-render/core";
import type { ActivityItem } from "./activity";
export function builder() {
  const elements: Spec["elements"] = {};
  let serial = 0;
  const node = (type: string, props: Record<string, unknown>, children: string[] = [], id = `detail-${serial++}`) => { elements[id] = { type, props, children }; return id; };
  const text = (value: string, variant?: string) => variant === "error" ? node("Alert", { title: value, type: "error" }) : node("Text", { text: value, ...(variant ? { variant } : {}) });
  const heading = (value: string, level = "h3") => node("Heading", { text: value, level });
  const link = (label: string, href: string) => node("Link", { label, href });
  const time = (value: string) => node("Time", { value });
  const stack = (children: string[]) => node("Stack", { gap: "sm" }, children);
  const row = (children: string[]) => node("Stack", { direction: "horizontal", gap: "sm", align: "center" }, children);
  const list = (children: string[], empty = "没有。") => children.length ? node("List", {}, children) : text(empty, "muted");
  const activity = (items: ActivityItem[], module: string) => stack([list(items.map(item => {
    const parts = [time(item.at), text(item.text)];
    if (item.session) parts.push(link("查看过程", item.session.source === "build" ? `/sessions/${item.session.id}` : `/apps/system/${encodeURIComponent(String(item.module))}?session=${encodeURIComponent(item.session.id)}`));
    return stack(parts);
  }), "还没有活动。"), link("查看全部活动", `/activity?module=${encodeURIComponent(module)}`)]);
  const finish = (title: string, children: string[]): Spec => ({ root: node("Card", { title }, children), elements });
  return { node, text, heading, link, time, stack, row, list, activity, finish };
}
export type Builder = ReturnType<typeof builder>;

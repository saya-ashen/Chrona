import { builder } from "./spec";
import type { SettingsView } from "./types";
import { settingsHref, settingsPageForApp, settingsUnavailable, type PageOwner, type RegisteredPage } from "./registered-pages";
export type { GlobalSettings, SettingsView } from "./types";
export const settingsData = { settingsView: { tool: "settings" }, pages: { tool: "pages", refresh: 5 }, apps: { tool: "modules", refresh: 5 } };
export function settingsSpec(state: Record<string, unknown>) {
  const b = builder(), view = state.settingsView as SettingsView | undefined;
  const section = (title: string, children: string[]) => b.node("Card", { title }, children);
  const pages = state.pages as RegisteredPage[] | undefined, apps = state.apps as PageOwner[] | undefined;
  const appRows = [b.text("各应用提供自己的设置页面。", "muted")];
  if (!apps) appRows.push(b.text("正在读取应用目录……", "muted"));
  else appRows.push(b.list(apps.map(app => {
    const page = settingsPageForApp(pages, app);
    return b.stack([b.heading(app.name), page ? b.link("打开设置", settingsHref(app.id)) : b.text(settingsUnavailable(pages, app), "muted"), b.link("查看应用", `/apps/${encodeURIComponent(app.id)}`)]);
  }), "还没有安装应用。"));
  const settings = view?.settings, current = settings?.moduleModel;
  const spec = b.finish("设置", [
    section("内核", settings ? [
      b.heading("模型调用硬上限"),
      ...(!current ? [b.text("尚未启用模型调用额度；应用配置模型后仍需启用内核额度。", "muted")] : []),
      b.node("NotificationSettings", { settings: { timezone: settings.timezone }, section: "budget" }),
      b.node("ModuleModelSettings", { settings: { timezone: settings.timezone, moduleModel: current }, section: "caps" }),
      b.heading("今日用量"),
      b.list((settings.modelUsage ?? []).map(row => b.stack([b.text(`${row.module}：${row.calls} 次`), b.text(`输入 ${row.inputTokens} / 输出 ${row.outputTokens} token${current?.moduleDailyCalls?.[row.module] !== undefined ? ` · 上限 ${current.moduleDailyCalls[row.module]}` : ""}`, "muted")])), "今天还没有模块调用模型。"),
    ] : [b.text("加载中……正在读取内核设置。", "muted")]),
    section("应用设置", appRows),
  ]);
  spec.elements[spec.root] = { type: "Stack", props: { gap: "lg" }, children: spec.elements[spec.root]!.children };
  return spec;
}

import type { Spec } from "@json-render/core";
import { todayData, todaySpec } from "./today";
import { loginSpec, type LoginMode } from "./login";
import { activityData, activitySpec } from "./activity";
import { appsData, appsSpec } from "./apps";
import { settingsData, settingsSpec } from "./settings";
import { detailData, detailSpec, type DetailRoute } from "./detail";
import { chatData, chatSpec } from "./chat";
import { builder } from "./spec";

export type SystemParams =
  | { name: "today" | "apps" | "settings" }
  | { name: "login"; message?: string; mode?: LoginMode }
  | { name: "activity"; module: string }
  | { name: "chat"; path: string }
  | { name: "chat-unavailable"; message: string }
  | ({ name: "app" | "system-app" } & DetailRoute)
  | { name: "error"; message: string };

export function systemPage(params: SystemParams): { data: Record<string, { tool: string; args?: Record<string, unknown>; refresh?: number }>; spec: (state: Record<string, unknown>) => Spec } {
  switch (params.name) {
    case "today": return { data: todayData, spec: todaySpec };
    case "apps": return { data: appsData, spec: appsSpec };
    case "settings": return { data: settingsData, spec: settingsSpec };
    case "login": return { data: {}, spec: () => loginSpec(params.message, params.mode) };
    case "activity": return { data: activityData(params.module), spec: state => activitySpec(state, params.module) };
    case "chat-unavailable": return { data: {}, spec: () => { const b = builder(); return b.finish("Chat 暂不可用", [b.text(params.message, "error"), b.link("检查应用", "/apps")]); } };
    case "chat": return { data: chatData, spec: state => chatSpec(state, params.path) };
    case "app": return { data: detailData(params, false), spec: state => detailSpec(state, params) };
    case "system-app": return { data: detailData(params, true), spec: state => detailSpec(state, params, true) };
    case "error": return { data: {}, spec: () => {
      const b = builder();
      return b.finish("页面暂时无法打开", [b.text(params.message, "error"), b.link("返回今天", "/")]);
    } };
  }
}

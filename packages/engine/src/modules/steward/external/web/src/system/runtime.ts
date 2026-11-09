import type { RuntimeCapability } from "./detail-types";
export function runtimeCapabilityText(runtime: RuntimeCapability) {
  if (runtime.status === "unconfigured") return "后端未配置";
  if (runtime.status === "configured") return `后端已配置：${runtime.backend}（不代表当前运行可用）`;
  return "已注册 · 按需使用（不代表已有活跃运行）";
}
export const runtimeCapabilityBoundary = "受信任的本机能力，随 Chrona 发行。执行工具供内核调用，运行回传也接受受信任 Agent；不能在这里启动、停用或删除。";

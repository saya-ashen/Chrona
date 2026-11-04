import type { ModuleModel } from "./settings";
export const THINKING = ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"];
export type TierRow = { tier: string; model: string; thinking: string };
export type CapRow = { module: string; calls: string };
export const modelNumbers = [
  { name: "maxCallsPerEvent", label: "每次事件最多调用", fallback: 3, min: 1, max: 20 },
  { name: "maxOutputTokens", label: "单次最多输出 token", fallback: 4000, min: 1, max: 32000 },
  { name: "dailyCalls", label: "全部模块每天合计", fallback: 30, min: 1, max: 10000 },
  { name: "timeoutSeconds", label: "超时（秒）", fallback: 180, min: 5, max: 600 },
] as const;
export function modelValue(tiers: TierRow[], caps: CapRow[], numbers: Record<string, string>): ModuleModel {
  const models = Object.fromEntries(tiers.map(row => ({ ...row, tier: row.tier.trim(), model: row.model.trim() })).filter(row => row.tier && row.model).map(row => [row.tier, { model: row.model, ...(row.thinking ? { thinking: row.thinking } : {}) }]));
  const moduleDailyCalls = Object.fromEntries(caps.map(row => ({ ...row, module: row.module.trim() })).filter(row => row.module && row.calls !== "").map(row => [row.module, Number(row.calls)]));
  return { models, maxCallsPerEvent: Number(numbers.maxCallsPerEvent), maxOutputTokens: Number(numbers.maxOutputTokens), dailyCalls: Number(numbers.dailyCalls), timeoutMs: Number(numbers.timeoutSeconds) * 1000, ...(Object.keys(moduleDailyCalls).length ? { moduleDailyCalls } : {}) };
}

/** Presentation helpers only; Mind's tools own validation, scheduling and execution. */
export const state = (path: string) => ({ $state: path });
export const bind = (path: string) => ({ $bindState: path });
export const item = (path: string) => ({ $item: path });
export const node = (type: string, props: Record<string, unknown>, children: string[] = []) => ({ type, props, children });
export const flag = (condition: unknown) => ({ $cond: condition, $then: true, $else: false });
export const otherwise = (value: unknown, fallback: unknown) => ({ $cond: value, $then: value, $else: fallback });
export const set = (path: string, value: unknown) => ({ action: "setState", params: { statePath: path, value } });
export const statusOptions = [
  { value: "watching", label: "持续关注" }, { value: "acting", label: "正在处理" },
  { value: "waiting-user", label: "等我处理" }, { value: "waiting-external", label: "等待外部进展" },
  { value: "done", label: "已完成" }, { value: "dropped", label: "已放下" },
];
export const statusLabel = statusOptions.reduceRight<unknown>((fallback, option) => ({
  $cond: { $item: "status", eq: option.value }, $then: option.label, $else: fallback,
}), "状态待确认");
export const phaseLabel = (value: unknown) => [
  ["idle", "等待下次检查"], ["prepared", "检查已准备"], ["running", "正在检查"],
  ["waiting", "等待补充或外部结果"], ["unknown", "执行结果待确认；不会自动重试"],
  ["completed", "检查已完成"], ["unreported", "执行结束但缺少已核实报告"], ["failed", "本次检查未完成"],
].reduceRight<unknown>((fallback, [phase, label]) => ({ $cond: { ...(value as Record<string, unknown>), eq: phase }, $then: label, $else: fallback }), "检查状态待确认");
export const emptyConcern = { id: "", title: "", goal: "", project: "", status: "watching", "due-at": "", "revisit-at": "", "silent-until": "", "expected-progress-at": "" };
export const concernFields = [
  ["title", "关注什么", "例如：确认申请材料已收到"], ["goal", "希望达成什么", "写下目标或完成条件"],
  ["project", "所属项目（可选）", "项目引用；没有可留空"], ["due-at", "截止时间（可选）", "2026-12-01T09:00:00+08:00"],
  ["revisit-at", "下次复查时间（可选）", "带时区的日期时间"], ["silent-until", "暂不打扰至（可选）", "带时区的日期时间"],
  ["expected-progress-at", "预计有进展的时间（可选）", "带时区的日期时间"],
] as const;

/** A lost reply stays uncertain. A second press must never silently repeat a mutation. */
export const mutation = (tool: string, args: Record<string, unknown>, path: string, result: string) => [
  set(path, "pending"),
  { action: "call", params: { tool, args, result, reload: false }, onSuccess: set(path, "saved"), onError: set(path, "unknown") },
];
export const locked = (path: string) => flag({ $or: [{ $state: path, eq: "pending" }, { $state: path, eq: "unknown" }] });
export const mutationNotice = (path: string) => ({
  pending: { ...node("Text", { text: "正在提交，请稍候……", variant: "muted" }), visible: { $state: path, eq: "pending" } },
  unknown: { ...node("Alert", { title: "提交结果待确认", message: "请求可能已被接收。请先刷新并核对记录；页面不会自动重试。", type: "warning" }), visible: { $state: path, eq: "unknown" } },
});

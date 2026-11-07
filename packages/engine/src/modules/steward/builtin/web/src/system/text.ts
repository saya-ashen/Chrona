type Health = { runtime?: { state: string }; readiness?: { status: string; summary: string; nextAction: string | null; reportedAt: string | null; stale: boolean } };
const runtimes: Record<string, string> = { running: "运行中", starting: "启动中", backoff: "等待恢复", idle: "正常休眠（按需启动）", unavailable: "当前不可用", paused: "已暂停", unobserved: "当前进程状态未观测" };
const faults: Record<string, string> = { retrying: "正在有限恢复", verifying: "连接已恢复，功能待验证", unresolved: "未解决，需要处理", recovered: "对应调用已验证恢复" };
export const runtimeText = (health: Health) => runtimes[health.runtime?.state ?? ""] ?? "当前进程状态未知";
export function readinessText(health: Health) {
  const report = health.readiness;
  if (!report?.reportedAt) return "业务就绪情况：模块尚未报告";
  if (report.stale) return "业务就绪情况未知（模块报告已过期或进程不可用）";
  if (report.status === "unknown") return "业务就绪情况未知（模块尚无法确认）";
  const labels: Record<string, string> = { ready: "已就绪", needs_configuration: "待配置", degraded: "部分可用" };
  return `模块自报：${labels[report.status] ?? "未知"} · ${report.summary}${report.nextAction ? ` · ${report.nextAction}` : ""}`;
}
export const faultText = (status: string) => faults[status] ?? status;

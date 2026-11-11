type Health = { runtime?: { state: string } };
const runtimes: Record<string, string> = { running: "运行中", starting: "启动中", stopping: "正在停止（尚未确认）", unknown: "停止结果未知", backoff: "等待恢复", idle: "正常休眠（按需启动）", unavailable: "当前不可用", paused: "已暂停", unobserved: "当前进程状态未观测" };
const faults: Record<string, string> = { retrying: "正在有限恢复", verifying: "连接已恢复，功能待验证", unresolved: "未解决，需要处理", recovered: "对应调用已验证恢复" };
export const runtimeText = (health: Health) => runtimes[health.runtime?.state ?? ""] ?? "当前进程状态未知";
export const faultText = (status: string) => faults[status] ?? status;

import type { Prisma } from "@chrona/db";
import { RUN_LIMITS } from "@chrona/contracts/steward";
import { StewardError } from "./errors";

type Db = Prisma.TransactionClient;
type QueueState = { runId: string; status: "build_running" | "build_queued"; queuePosition: number; aheadCount: number; waitUntil: string | null };
/** Admission and display use the same persistent run queue; no second scheduler. */
export async function assertBuildQueueSpace(db: Db, workspaceId: string, replacingSession?: string) {
  const queued = await db.run.count({ where: { workspaceId, lane: "build", status: "queued", ...(replacingSession ? { sessionId: { not: replacingSession } } : {}) } });
  if (queued >= RUN_LIMITS.maxQueuedBuilds) throw new StewardError("conflict", `Build queue is full (${RUN_LIMITS.maxQueuedBuilds} waiting); cancel a queued build or wait for it to start`);
}
export async function buildQueue(db: Db, workspaceId: string): Promise<Map<string, QueueState>> {
  const rows = await db.run.findMany({ where: { workspaceId, lane: "build", status: { in: ["queued", "running"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, sessionId: true, status: true, leaseUntil: true } });
  const running = rows.filter(row => row.status === "running").length;
  let position = 0;
  return new Map(rows.filter(row => row.sessionId).map(row => [row.sessionId!, {
    runId: row.id, status: row.status === "running" ? "build_running" : "build_queued",
    queuePosition: row.status === "queued" ? ++position : 0,
    aheadCount: row.status === "queued" ? running + position - 1 : 0,
    waitUntil: row.status === "queued" ? row.leaseUntil?.toISOString() ?? null : null,
  }]));
}
export function buildQueueText(state: QueueState) {
  return state.status === "build_running" ? "正在构建" : `排队第 ${state.queuePosition} 位 · 前面 ${state.aheadCount} 个构建${state.waitUntil ? " · 等待运行额度恢复" : ""}`;
}

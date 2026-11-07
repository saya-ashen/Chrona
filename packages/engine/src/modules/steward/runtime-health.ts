import type { Health } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/local-day";
import type { StewardPorts } from "./ports";
import { notificationSettings } from "./settings";
import { runtimeCall } from "./local-runtime";

/** Facts owned by the runtime; application health and page composition stay with modules. */
export async function runtimeHealth(ports: StewardPorts, workspaceId: string) {
  const at = ports.now(), settings = notificationSettings((await ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).settings);
  let provider: Health["provider"] = { name: "unconfigured", available: false, sandboxed: false, lastError: null };
  if (ports.provider) {
    try { const h = await runtimeCall<{ name: string; available: boolean; sandboxed: boolean; error: string | null }>(ports, workspaceId, "agent.health", {}); provider = { name: h.name, available: h.available, sandboxed: h.sandboxed, lastError: h.error?.slice(0, 500) ?? null }; }
    catch { provider = { name: ports.provider.name, available: false, sandboxed: false, lastError: "Provider health check failed" }; }
  }
  const [runs, dueSchedules, state] = await Promise.all([
    ports.db.run.findMany({ where: { workspaceId, OR: [{ status: { in: ["queued", "running"] } }, { createdAt: { gte: new Date(at.getTime() - 48 * 3600000) } }] } }),
    ports.db.schedule.count({ where: { workspaceId, status: "active", nextAt: { lte: at } } }),
    ports.db.stewardState.findUnique({ where: { workspaceId } }),
  ]);
  const day = localDayKey(at, settings.timezone);
  return { at: at.toISOString(), provider, moduleSandbox: ports.sandbox?.isolated ?? false,
    queuedRuns: runs.filter(r => r.status === "queued").length, runningRuns: runs.filter(r => r.status === "running").length,
    failedRunsToday: runs.filter(r => ["failed", "timed_out", "provider_unavailable"].includes(r.status) && localDayKey(r.endedAt ?? r.createdAt, settings.timezone) === day).length,
    dueSchedules, lastTickAt: state?.lastTickAt?.toISOString() ?? null };
}

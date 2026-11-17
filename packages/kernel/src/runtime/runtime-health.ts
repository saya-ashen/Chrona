import type { Health } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/local-day";
import type { StewardPorts } from "../ports";
import { budgetTimezone } from "../settings";
import { listAgentProviders } from "../agent/agent-provider";

/** Facts owned by the runtime; application health and page composition stay with modules. */
export async function runtimeHealth(ports: StewardPorts, workspaceId: string) {
  const at = ports.now(), since = new Date(at.getTime() - 48 * 3600000);
  const [workspace, registered, runs, failures, state] = await Promise.all([
    ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { settings: true } }),
    listAgentProviders(ports, workspaceId, { limit: 100 }),
    ports.db.run.groupBy({ by: ["status"], where: { workspaceId, status: { in: ["queued", "running"] } }, _count: { _all: true } }),
    ports.db.run.findMany({ where: { workspaceId, status: { in: ["failed", "timed_out", "provider_unavailable"] },
      OR: [{ endedAt: { gte: since } }, { endedAt: null, createdAt: { gte: since } }],
    }, select: { createdAt: true, endedAt: true } }),
    ports.db.stewardState.findUnique({ where: { workspaceId }, select: { lastTickAt: true } }),
  ]);
  const timezone = budgetTimezone(workspace.settings);
  let provider: Health["provider"] = { name: "unconfigured", available: false, sandboxed: false, lastError: null };
  const available = registered.items.filter(item => item.available);
  if (registered.items.length) provider = { name: available.length === 1 ? available[0]!.name : "registered", available: available.length > 0, sandboxed: ports.sandbox?.isolated ?? false, lastError: available.length ? null : "No available registered provider" };
  const day = localDayKey(at, timezone);
  const counts = { queued: 0, running: 0, ...Object.fromEntries(runs.map(row => [row.status, row._count._all])) };
  return { at: at.toISOString(), provider, moduleSandbox: ports.sandbox?.isolated ?? false,
    queuedRuns: counts.queued, runningRuns: counts.running,
    failedRunsToday: failures.filter(r => localDayKey(r.endedAt ?? r.createdAt, timezone) === day).length,
    lastTickAt: state?.lastTickAt?.toISOString() ?? null };
}

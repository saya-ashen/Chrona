import type { Health } from "@chrona/contracts/steward";
import { localDayKey } from "@chrona/domain/steward/local-day";
import type { StewardPorts } from "./ports";
import { budgetTimezone } from "./settings";
import { listAgentProviders } from "./agent-provider";

/** Facts owned by the runtime; application health and page composition stay with modules. */
export async function runtimeHealth(ports: StewardPorts, workspaceId: string) {
  const at = ports.now();
  const [workspace, registered, runs, state] = await Promise.all([
    ports.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    listAgentProviders(ports, workspaceId, { limit: 100 }),
    ports.db.run.findMany({ where: { workspaceId, OR: [{ status: { in: ["queued", "running"] } }, { createdAt: { gte: new Date(at.getTime() - 48 * 3600000) } }] } }),
    ports.db.stewardState.findUnique({ where: { workspaceId } }),
  ]);
  const timezone = budgetTimezone(workspace.settings);
  let provider: Health["provider"] = { name: "unconfigured", available: false, sandboxed: false, lastError: null };
  const available = registered.items.filter(item => item.available);
  if (registered.items.length) provider = { name: available.length === 1 ? available[0]!.name : "registered", available: available.length > 0, sandboxed: ports.sandbox?.isolated ?? false, lastError: available.length ? null : "No available registered provider" };
  const day = localDayKey(at, timezone);
  return { at: at.toISOString(), provider, moduleSandbox: ports.sandbox?.isolated ?? false,
    queuedRuns: runs.filter(r => r.status === "queued").length, runningRuns: runs.filter(r => r.status === "running").length,
    failedRunsToday: runs.filter(r => ["failed", "timed_out", "provider_unavailable"].includes(r.status) && localDayKey(r.endedAt ?? r.createdAt, timezone) === day).length,
    lastTickAt: state?.lastTickAt?.toISOString() ?? null };
}

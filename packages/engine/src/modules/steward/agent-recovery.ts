import type { StewardPorts } from "./ports";
import { finishRunFromProviderStatus } from "./agent-provider-finalization";
import { CallError } from "./module-call-error";
import { callProviderEndpoint, runProviderBinding } from "./agent-provider";
import { liveRuns } from "./runs";

/** Reconnect only to a previously admitted operation; this never launches a Provider. */
export async function reconcileAgentStops(ports: StewardPorts, workspaceId: string) {
  const rows = await ports.db.run.findMany({ where: { workspaceId, stopStatus: "unknown", execution: null, providerLaunch: { isNot: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10 });
  for (const run of rows) {
    if (liveRuns.has(run.id)) continue;
    let status: unknown;
    try { status = await callProviderEndpoint(ports, workspaceId, await runProviderBinding(ports, workspaceId, run.id), "status", { operationId: run.id }); }
    catch (error) {
      if (error instanceof CallError && ["not_found", "unavailable", "unknown", "forbidden", "conflict"].includes(error.code)) continue;
      throw error;
    }
    // Missing/uncertain receipts are not stop evidence and cannot release capacity.
    await finishRunFromProviderStatus(ports, workspaceId, run.id, status);
  }
}

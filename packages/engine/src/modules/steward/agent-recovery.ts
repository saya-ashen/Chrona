import type { StewardPorts } from "./ports";
import { runtimeOutcomeSchema } from "@chrona/contracts/steward";
import { CallError } from "./module-call-error";
import { runtimeCall } from "./local-runtime";
import { createRuns, liveRuns } from "./runs";

/** Reconnect only to a previously admitted operation; this never launches a Provider. */
export async function reconcileAgentStops(ports: StewardPorts, workspaceId: string) {
  const rows = await ports.db.run.findMany({ where: { workspaceId, stopStatus: "unknown", execution: null, providerLaunch: { isNot: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10 });
  for (const run of rows) {
    if (liveRuns.has(run.id)) continue;
    let status: { outcome: unknown; failure: boolean };
    try { status = await runtimeCall(ports, workspaceId, "agent.status", { operationId: run.id }); }
    catch (error) {
      if (error instanceof CallError && ["not_found", "unavailable", "unknown"].includes(error.code)) continue;
      throw error;
    }
    // Missing/uncertain receipts are not stop evidence and cannot release capacity.
    if (!status.outcome) continue;
    const outcome = runtimeOutcomeSchema.parse(status.outcome);
    await createRuns(ports, workspaceId).finish(run.id, outcome, { stopEvidence: "provider_exited" });
  }
}

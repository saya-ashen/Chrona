import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "../ports";
import { finishRunIn } from "../execution/run-finish";
import { liveRuns } from "../execution/run-live";
import { callProviderEndpoint, runProviderBinding } from "./agent-provider";

export async function fenceAgentModuleIn(ports: StewardPorts, tx: Prisma.TransactionClient, workspaceId: string, moduleId: string) {
  await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
  const now = ports.now();
  await tx.module.updateMany({ where: { id: moduleId, workspaceId }, data: { executionFenceAt: now } });
  const runs = await tx.run.findMany({ where: { workspaceId,
    AND: [
      { OR: [{ status: { in: ["queued", "running"] } }, { stopStatus: "unknown" }] },
      { OR: [{ agentAdmission: { moduleId } }, { session: { moduleId } }, { agentProvider: { moduleId } }] },
    ],
  }, include: { providerLaunch: true } });
  for (const run of runs) {
    await tx.run.update({ where: { id: run.id }, data: { cancelRequestedAt: run.cancelRequestedAt ?? now } });
    await finishRunIn(ports, workspaceId, tx, run.id, { outcome: "failed", sessionId: null, error: "Application lifecycle drain" }, now, run.providerLaunch ? undefined : "never_started");
  }
  return { runs: runs.length, runIds: runs.map(run => run.id) };
}

export async function abortDrainedAgentRuns(ports: StewardPorts, workspaceId: string, runIds: string[]) {
  for (const runId of runIds) {
    try {
      const handle = liveRuns.get(runId);
      if (handle) await handle.abort();
      else if (await ports.db.providerLaunch.findUnique({ where: { runId } })) {
        await callProviderEndpoint(ports, workspaceId, await runProviderBinding(ports, workspaceId, runId), "abort", { operationId: runId }, `agent-drain:${runId}`);
      }
    } catch (error) {
      console.error(JSON.stringify({ component: "agent-drain", event: "abort.failed", runId, error: String(error) }));
    }
  }
}

export async function fenceAgentModule(ports: StewardPorts, workspaceId: string, moduleId: string) {
  const result = await ports.db.$transaction(tx => fenceAgentModuleIn(ports, tx, workspaceId, moduleId));
  await abortDrainedAgentRuns(ports, workspaceId, result.runIds);
  return { fenced: true, runs: result.runs };
}

export async function fenceAgentVersionChange(
  ports: StewardPorts, workspaceId: string, moduleId: string, hash: string,
  beforeFence?: (tx: Prisma.TransactionClient, current: Prisma.ModuleGetPayload<object> | null) => Promise<void>,
) {
  const result = await ports.db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${workspaceId}`;
    const current = await tx.module.findFirst({ where: { id: moduleId, workspaceId } });
    await beforeFence?.(tx, current);
    if (current && current.activeHash !== hash) return fenceAgentModuleIn(ports, tx, workspaceId, moduleId);
  });
  if (result) await abortDrainedAgentRuns(ports, workspaceId, result.runIds);
}

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { StewardPorts } from "./ports";
import { startOwnerBuild } from "./owner-build";
import { createRuns, liveRuns } from "./runs";
import { createProviderChannel } from "./provider-channel";
import { BUILD_MODULE_TOOLS, BUILD_REFERENCE_PROMPT } from "./module-reference";
import { buildPending } from "./module-build";
import { moduleContext } from "./module-context";
import { moduleSupervisor } from "./module-supervisor";
import { StewardError } from "./errors";

/** Recovery only, under the CLI's exclusive database lock: no normal tick, built-in upgrades or other jobs. */
export async function runOwnerBuild(ports: StewardPorts, workspaceId: string, input: unknown) {
  if (await ports.db.run.count({ where: { workspaceId, status: { in: ["queued", "running"] } } }) ||
      await ports.db.moduleVersion.count({ where: { module: { workspaceId }, status: { in: ["building", "testing"] } } })) throw new StewardError("conflict", "Finish or cancel existing work before a recovery build");
  await moduleSupervisor(ports).stop();
  const receipt = await startOwnerBuild(ports, workspaceId, input);
  if (receipt.duplicate) return receipt;
  const runs = createRuns(ports, workspaceId), run = await runs.claimNext("build");
  if (!run || run.id !== receipt.runId) {
    await ports.db.run.updateMany({ where: { id: receipt.runId, status: "queued" }, data: { status: "cancelled", endedAt: ports.now() } });
    throw new StewardError("conflict", "Recovery build was not admitted; it will not be retried");
  }
  const sessionDir = join(run.cwd, ".chrona", "sessions");
  await mkdir(sessionDir, { recursive: true });
  const channel = createProviderChannel(ports, run);
  let handle: ReturnType<NonNullable<StewardPorts["provider"]>["start"]> | undefined;
  try {
    await runs.authenticate(run.token);
    handle = ports.provider!.start({ runId: run.id, token: run.token, lane: "build", cwd: run.cwd, sessionDir, sessionId: null,
      model: run.model, prompt: `${run.prompt}\n\n${BUILD_REFERENCE_PROMPT}`, deadline: run.deadlineAt, events: channel.events,
      extraTools: BUILD_MODULE_TOOLS, searchTools: true, hostPaths: [], content: [] });
    liveRuns.set(run.id, handle);
    let done = false;
    const outcome = handle.done.finally(() => { done = true; });
    // The author awaits check results while the same normal sandbox build worker checks its proposals.
    while (!(done as boolean)) {
      await buildPending(moduleContext(ports, workspaceId), ports.now());
      await Promise.race([outcome, new Promise(resolve => setTimeout(resolve, 100))]);
    }
    await runs.finish(run.id, await outcome);
    return { ...receipt, status: (await ports.db.run.findUniqueOrThrow({ where: { id: run.id } })).status };
  } catch (error) {
    await handle?.abort();
    await runs.finish(run.id, { outcome: "failed", sessionId: null, error: "Recovery build failed; explicit authorization is required for another run" });
    throw error;
  } finally {
    liveRuns.delete(run.id);
    await channel.close();
    await moduleSupervisor(ports).stop();
  }
}

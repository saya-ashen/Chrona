import type { StewardPorts } from "../ports";
import { callProviderEndpoint, runProviderBinding } from "./agent-provider";
import { settleRunProviderStatus } from "./agent-completion-settlement";
import { createRuns } from "../execution/runs";
import { liveRuns } from "../execution/run-live";
import { releaseRegisteredCompletion } from "../execution/execution-delivery-completion";

/** Stop evidence may close a completion Run only after its durable settlement. */
export async function finishRunFromProviderStatus(ports: StewardPorts, workspaceId: string, runId: string, raw: unknown) {
  const outcome = await settleRunProviderStatus(ports, workspaceId, runId, raw);
  if (!outcome) return;
  const observedLive = liveRuns.has(runId);
  await createRuns(ports, workspaceId).finish(runId, outcome, { stopEvidence: "provider_exited" });
  const binding = await runProviderBinding(ports, workspaceId, runId);
  // An attached observer owns its own bounded release after the same settlement.
  if (binding.kind === "completion" && !observedLive) await releaseRegisteredCompletion((name, args, key) => callProviderEndpoint(ports, workspaceId, binding, name, args, key), runId);
}

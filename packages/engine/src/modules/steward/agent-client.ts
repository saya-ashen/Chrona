import type { ProviderAdapter } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { runtimeCall, startLocalProvider } from "./local-runtime";

/** Provider-facing metadata and compatibility calls route to the application; no Pi adapter lives in the kernel. */
export function createAgentClient(ports: () => StewardPorts, name: string): ProviderAdapter {
  return {
    name, supportsRunModel: true,
    health: () => runtimeCall(ports(), "ws_default", "agent.health", {}),
    complete: input => runtimeCall(ports(), "ws_default", "agent.complete", input),
    transcript: input => runtimeCall(ports(), "ws_default", "agent.transcript", input),
    start(input) {
      const pending = (async () => {
        const run = await ports().db.run.findUniqueOrThrow({ where: { id: input.runId }, select: { workspaceId: true } });
        return startLocalProvider(ports(), run.workspaceId, input);
      })();
      return { done: pending.then(handle => handle.done), async inject(message, images) { await (await pending).inject(message, images); }, async abort() { await (await pending).abort(); } };
    },
  };
}

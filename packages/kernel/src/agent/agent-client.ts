import type { ProviderAdapter } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { startLocalProvider } from "../execution/local-runtime";
import { listAgentProviders } from "./agent-provider";

/** Generic host seam. Every start uses the Run's previously admitted provider binding. */
export function createRegisteredProviderClient(getPorts: () => StewardPorts): ProviderAdapter {
  return {
    name: "registered", supportsRunModel: true,
    async health() {
      const ports = getPorts(), workspaces = await ports.db.workspace.findMany({ select: { id: true } });
      let available = false;
      for (const workspace of workspaces) {
        const page = await listAgentProviders(ports, workspace.id, { limit: 100 });
        available ||= page.items.some(provider => provider.available);
      }
      return { available, sandboxed: ports.sandbox?.isolated ?? false, error: available ? null : "No available registered provider" };
    },
    start(input) {
      const ports = getPorts();
      const pending = (async () => {
        const run = await ports.db.run.findUniqueOrThrow({ where: { id: input.runId }, select: { workspaceId: true } });
        return { handle: await startLocalProvider(ports, run.workspaceId, input), workspaceId: run.workspaceId };
      })();
      return {
        done: pending.then(({ handle }) => handle.done),
        async inject(message, images) { await (await pending).handle.inject(message, images); },
        async abort() { await (await pending).handle.abort(); },

      };
    },
  };
}

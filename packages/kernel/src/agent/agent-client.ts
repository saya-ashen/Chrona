import type { StewardPorts } from "../ports";
import { listAgentProviders } from "./agent-provider";

export async function registeredProviderHealth(ports: StewardPorts) {
  const workspaces = await ports.db.workspace.findMany({ select: { id: true } });
  let available = false;
  for (const workspace of workspaces) {
    const page = await listAgentProviders(ports, workspace.id, { limit: 100 });
    available ||= page.items.some(provider => provider.available);
  }
  return { name: "registered", available, sandboxed: ports.sandbox?.isolated ?? false };
}

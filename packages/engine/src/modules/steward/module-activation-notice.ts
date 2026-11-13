import { moduleManifestSchema } from "@chrona/contracts/steward";
import { notifyLifecycle } from "./notify-user";
import type { ModuleContext, ModuleVersion } from "./module-context";

export async function rejectedUpdateNotice({ ports, workspaceId, tx, module, hash, error }: {
  ports: ModuleContext["ports"];
  workspaceId: string;
  tx: Parameters<typeof notifyLifecycle>[0];
  module: { id: string; name: string; activeHash: string | null };
  hash: string;
  error: string;
}) {
  if (!module.activeHash || module.activeHash === hash) return;
  await notifyLifecycle(tx, ports, workspaceId, `module-update-rejected:${module.id}:${hash}`, { kind: "module-update-rejected", app: module.name, hash, activeHash: module.activeHash, error: error.slice(0, 300), module: module.id });
}

export async function activationNotice(context: ModuleContext, tx: Parameters<typeof notifyLifecycle>[0], version: ModuleVersion, update: boolean) {
  const manifest = moduleManifestSchema.parse(version.manifest);
  await notifyLifecycle(tx, context.ports, context.workspaceId, `module-auto-activated:${version.id}`, { kind: "module-activated", app: manifest.name, update, hash: version.hash, module: version.moduleId });
}

import { moduleManifestSchema } from "@chrona/contracts/steward";
import { notifyLifecycle } from "./notify-user";
import type { ModuleContext, ModuleVersion } from "./module-context";

export async function activationNotice(context: ModuleContext, tx: Parameters<typeof notifyLifecycle>[0], version: ModuleVersion, update: boolean) {
  const manifest = moduleManifestSchema.parse(version.manifest);
  await notifyLifecycle(tx, context.ports, context.workspaceId, `module-auto-activated:${version.id}`, { kind: "module-activated", app: manifest.name, update, hash: version.hash, module: version.moduleId });
}

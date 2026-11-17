import { appSchema, moduleManifestSchema } from "@chrona/contracts/steward";
import { moduleIdentity } from "./modules/module-identity";
import type { StewardPorts } from "./ports";

export function createApps(ports: StewardPorts, workspaceId: string) {
  return {
    async list() {
      const modules = await ports.db.module.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true, builtin: true, status: true, activeHash: true } });
      return Promise.all(modules.map(async module => {
        const version = module.activeHash ? await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } }, select: { manifest: true } }) : null;
        const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
        return appSchema.parse({ ...moduleIdentity(module), id: module.id, name: module.name, description: manifest?.description ?? null, status: module.status, builtin: module.builtin, activeHash: module.activeHash });
      }));
    },
  };
}

import { appSchema, moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";

export function createApps(ports: StewardPorts, workspaceId: string) {
  return {
    async list() {
      const modules = await ports.db.module.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
      return Promise.all(modules.map(async module => {
        const version = module.activeHash ? await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
        const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
        return appSchema.parse({ id: module.id, name: module.name, description: manifest?.description ?? null, status: module.status, builtin: module.builtin, activeHash: module.activeHash });
      }));
    },
  };
}

import { appSchema, moduleManifestSchema, relativePathSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { contentArea } from "./content";

export function createApps(ports: StewardPorts, workspaceId: string) {
  return {
    async list() {
      const modules = await ports.db.module.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
      return Promise.all(modules.map(async module => {
        const version = module.activeHash ? await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash } } }) : null;
        const manifest = moduleManifestSchema.safeParse(version?.manifest).data;
        let entry: string | null = null;
        if (manifest?.content) {
          const area = await contentArea(ports, workspaceId, module.id);
          try { entry = relativePathSchema.parse((await area.read(".chrona/entry")).content.trim()); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          if (entry === null) {
            try { await area.raw("README.md"); entry = "README.md"; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          }
        }
        return appSchema.parse({ id: module.id, name: module.name, description: manifest?.description ?? null, status: module.status, builtin: module.builtin, content: manifest?.content ?? false, activeHash: module.activeHash, entry });
      }));
    },
  };
}

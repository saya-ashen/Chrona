import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";

/** Declare a files content area for connector tests without starting a module process. */
export async function testFilesContent(ports: StewardPorts, workspaceId: string) {
  const module = await ports.db.module.create({ data: { workspaceId, name: "files", builtin: true, activeHash: "test-files" } });
  await ports.db.moduleVersion.create({ data: {
    moduleId: module.id, hash: "test-files", source: "user", status: "approved", intent: {}, report: {},
    manifest: moduleManifestSchema.parse({ name: "files", content: true, entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [] }),
  } });
  return module;
}

import { buildSettingsSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { audit } from "./audit";
import { buildSettings, buildUsage } from "./settings";
import { parseInput, StewardError } from "./errors";

/** Module build admission limits; no application settings are stored here. */
export function createBuildGovernance(ports: Pick<StewardPorts, "db" | "now">, workspaceId: string) {
  async function get() {
    const row = await ports.db.workspace.findUnique({ where: { id: workspaceId } });
    if (!row) throw new StewardError("not_found", "Workspace not found");
    return { builds: buildSettings(row.settings), buildUsage: await buildUsage(ports.db, workspaceId, row.settings, ports.now()) };
  }
  return { get, update: async (raw: unknown) => {
    const input = parseInput(buildSettingsSchema.partial(), raw);
    await ports.db.$transaction(async tx => {
      const row = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!row) throw new StewardError("not_found", "Workspace not found");
      const previous = row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings : {};
      await tx.workspace.update({ where: { id: workspaceId }, data: { settings: { ...previous, builds: { ...buildSettings(row.settings), ...input } } } });
      await audit(tx, { workspaceId, kind: "build_settings_updated", actor: "user", subjectId: workspaceId, details: input });
    });
    return get();
  } };
}

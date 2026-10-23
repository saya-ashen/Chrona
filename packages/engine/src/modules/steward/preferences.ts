import { chronaToolInputSchemas } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
type RecordContext = Pick<StewardPorts, "db" | "now"> & { workspaceId: string };
import { audit } from "./audit";
import { parseInput, StewardError } from "./errors";
import { toPreference } from "./store";
export function createPreferences({ db, workspaceId, now }: RecordContext) {
  return {
    list: async () => (await db.preference.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } })).map(toPreference),
    add: (raw: unknown, origin: "said" | "learned" = "said") => db.$transaction(async tx => {
      const input = parseInput(chronaToolInputSchemas.chrona_remember, raw);
      const existing = await tx.preference.findFirst({ where: { workspaceId, text: input.text, topic: input.topic } });
      if (existing) return toPreference(existing);
      const row = await tx.preference.create({ data: { ...input, workspaceId, origin, createdAt: now() } });
      await audit(tx, { workspaceId, kind: "preference_added", actor: origin === "said" ? "user" : "chrona", subjectId: row.id, details: {} });
      return toPreference(row);
    }),
    delete: (id: string) => db.$transaction(async tx => {
      if (!await tx.preference.findFirst({ where: { id, workspaceId } })) throw new StewardError("not_found", "Preference not found");
      await tx.preference.delete({ where: { id } });
      await audit(tx, { workspaceId, kind: "preference_deleted", actor: "user", subjectId: id, details: {} });
    }),
    markUsed: (id: string) => db.$transaction(async tx => {
      if (!await tx.preference.findFirst({ where: { id, workspaceId } })) throw new StewardError("not_found", "Preference not found");
      return toPreference(await tx.preference.update({ where: { id }, data: { lastUsedAt: now() } }));
    }),
  };
}

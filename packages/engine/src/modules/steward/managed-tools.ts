import { toolSpecSchema, validatePanelEntry } from "@chrona/domain/steward/tool-spec";
import { panelEntrySchema, toolDetailSchema, toolTransitionSchema } from "@chrona/contracts/steward";
import type { RecordContext } from "./affairs";
import { parseInput, StewardError } from "./errors";
import { toTool } from "./store";
import { audit } from "./audit";

/** Owner lifecycle operations; approval is bound to the exact immutable version. */
export function createManagedTools({ db, workspaceId, now }: RecordContext) {
  return {
    async getTool(id: string) {
      const tool = await db.managedTool.findFirst({ where: { id, workspaceId }, include: { versions: true, entries: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 500 }, runs: { orderBy: { startedAt: "desc" }, take: 20 } } });
      if (!tool) throw new StewardError("not_found", "Tool not found");
      return toolDetailSchema.parse({ tool: toTool(tool), entries: tool.entries.map(e => ({ id: e.id, toolId: e.toolId, values: e.values, createdAt: e.createdAt.toISOString() })), runs: tool.runs.map(r => ({ id: r.id, toolId: r.toolId, version: r.version, status: r.status, output: r.output, error: r.error, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null })) });
    },
    addEntry: (id: string, values: unknown) => db.$transaction(async tx => {
      const tool = await tx.managedTool.findFirst({ where: { id, workspaceId }, include: { versions: true } });
      if (!tool) throw new StewardError("not_found", "Tool not found");
      if (tool.kind !== "panel" || tool.state !== "enabled" || tool.approvedVersion !== tool.version) throw new StewardError("conflict", "Panel must be enabled and approved");
      const spec = toolSpecSchema.safeParse(tool.versions.find(v => v.version === tool.version)?.spec);
      if (!spec.success) throw new StewardError("invalid", "Invalid panel spec");
      const result = validatePanelEntry(spec.data, values);
      if (!result.passed) throw new StewardError("invalid", result.failures.join("；"));
      const entry = await tx.panelEntry.create({ data: { workspaceId, toolId: id, values: result.values, createdAt: now() } });
      await audit(tx, { workspaceId, kind: "panel_entry_added", actor: "user", subjectId: id, details: { entryId: entry.id } });
      return panelEntrySchema.parse({ id: entry.id, toolId: id, values: entry.values, createdAt: entry.createdAt.toISOString() });
    }),
    deleteEntry: (id: string, entryId: string) => db.$transaction(async tx => {
      const deleted = await tx.panelEntry.deleteMany({ where: { id: entryId, toolId: id, workspaceId } });
      if (!deleted.count) throw new StewardError("not_found", "Entry not found");
      await audit(tx, { workspaceId, kind: "panel_entry_deleted", actor: "user", subjectId: id, details: { entryId } });
    }),
    async list() {
      return (await db.managedTool.findMany({ where: { workspaceId }, include: { versions: true }, orderBy: { createdAt: "desc" } })).map(toTool);
    },
    transition: (id: string, raw: unknown) => db.$transaction(async tx => {
      const input = parseInput(toolTransitionSchema, raw);
      const tool = await tx.managedTool.findFirst({ where: { id, workspaceId }, include: { versions: true } });
      if (!tool) throw new StewardError("not_found", "Tool not found");
      if (tool.version !== input.expectedVersion) throw new StewardError("conflict", "Tool version changed");
      if (tool.state === "retired") throw new StewardError("conflict", "Tool is retired");
      const version = tool.versions.find(v => v.version === tool.version);
      if (!version) throw new Error("Missing current tool version");
      const at = now();
      let state: string;
      if (input.action === "approve") {
        if (!["draft", "disabled"].includes(tool.state)) throw new StewardError("conflict", "Tool cannot be approved");
        state = "approved";
        const grant = await tx.grant.create({ data: { workspaceId, action: tool.kind === "script" ? "run_script" : "enable_panel", mode: "preapproved", scope: { kind: "tool_version", toolId: id, version: tool.version }, once: false, origin: "user", createdAt: at } });
        await audit(tx, { workspaceId, kind: "grant_created", actor: "user", subjectId: grant.id, details: { toolId: id, version: tool.version } });
      } else if (input.action === "enable") {
        if (!["approved", "disabled"].includes(tool.state) || tool.approvedVersion !== tool.version) throw new StewardError("conflict", "Current version requires approval");
        state = "enabled";
      } else if (input.action === "disable") {
        if (tool.state !== "enabled") throw new StewardError("conflict", "Tool is not enabled");
        state = "disabled";
      } else state = "retired";
      const changed = await tx.managedTool.updateMany({ where: { id, workspaceId, version: input.expectedVersion, state: tool.state }, data: { state, ...(input.action === "approve" ? { approvedVersion: tool.version } : {}), updatedAt: at } });
      if (!changed.count) throw new StewardError("conflict", "Tool changed");
      await audit(tx, { workspaceId, kind: "tool_transition", actor: "user", subjectId: id, details: input });
      return toTool({ ...tool, state, approvedVersion: input.action === "approve" ? tool.version : tool.approvedVersion, updatedAt: at });
    }),
  };
}

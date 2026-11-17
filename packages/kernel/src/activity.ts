import { z } from "zod";
import { redactSensitiveText } from "@chrona/logging/redaction";
import type { StewardPorts } from "./ports";
import type { Json } from "./modules/module-call-types";

/** Only these audit facts may cross the module boundary. Never return raw audit details. */
const KINDS = ["approval_created", "approval_resolved", "module_build_started", "module_submission", "module_build_settled", "module_build_rejection",
  "module_activate", "module_auto_activated", "module_rollback", "admin_rollback", "module_migration_started", "module_runtime_incident", "module_disabled", "module_enabled",
  "grant_created", "grant_revoked", "settings_updated", "secret_set", "secret_removed", "reflection_started", "reflection_suggested", "module_settings_updated"] as const;
const recordSchema = z.object({ id: z.string(), at: z.string(), kind: z.string(), subject: z.string().nullable(), module: z.string().nullable(), hash: z.string().nullable(), approvalTitle: z.string().nullable(), details: z.record(z.string(), z.json()) });
export const activityRecordsOutput = z.object({ rows: z.array(recordSchema).max(200), before: z.string().nullable() });
const fields = ["id", "source", "decision", "hash", "succeeded", "automatic", "status", "deliveryUnknown", "failures", "from", "to", "reason", "unrestoredLegacyPause", "title", "why", "action", "mode", "name"];
const scalar = (value: unknown) => typeof value === "string" ? redactSensitiveText(value, 4000) : value;
function detailsView(raw: unknown, kind: string): Record<string, Json> {
  const details = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (kind === "settings_updated") return { settingsKeys: Object.keys(details) };
  const result: Record<string, Json> = {};
  for (const key of fields) {
    const value = scalar(details[key]);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) result[key] = value;
  }
  Object.assign(result, listDetails(details));
  const evidence = details.evidence as { reason?: unknown } | null;
  if (typeof evidence?.reason === "string") result.evidence = { reason: redactSensitiveText(evidence.reason, 4000) };
  return result;
}
function listDetails(details: Record<string, unknown>): Record<string, Json> {
  const result: Record<string, Json> = {};
  for (const key of ["keys", "modules"]) if (Array.isArray(details[key])) result[key] = details[key].filter((value): value is string => typeof value === "string").map(value => redactSensitiveText(value, 4000));
  for (const [key, allowed] of [["attempts", ["action"]], ["signals", ["kind", "module"]]] as const) if (Array.isArray(details[key])) result[key] = details[key].map(value => Object.fromEntries(allowed.flatMap(field => value && typeof value === "object" && typeof value[field] === "string" ? [[field, redactSensitiveText(value[field], 4000)]] : [])));
  return result;
}
/** Bounded, workspace-scoped persistence query; presentation and incident aggregation belong to applications. */
export async function activityRecords(ports: StewardPorts, workspaceId: string, { before, after, limit = 200, ascending = false }: { before?: string; after?: { at: Date; id: string }; limit?: number; ascending?: boolean }) {
  const { db } = ports, at = before ? new Date(before) : undefined, cursor = at && !Number.isNaN(at.getTime()) ? at : undefined;
  const rows = await db.audit.findMany({ where: { workspaceId, kind: { in: [...KINDS] }, ...(cursor ? { createdAt: { lt: cursor } } : {}), ...(after ? { OR: [{ createdAt: { gt: after.at } }, { createdAt: after.at, id: { gt: after.id } }] } : {}) }, orderBy: [{ createdAt: ascending ? "asc" : "desc" }, { id: ascending ? "asc" : "desc" }], take: limit });
  const ids = [...new Set(rows.flatMap(row => row.subjectId ? [row.subjectId] : []))];
  const modules = new Map((await db.module.findMany({ where: { workspaceId }, select: { id: true, name: true } })).map(row => [row.id, row.name]));
  const versions = new Map((await db.moduleVersion.findMany({ where: { module: { workspaceId }, id: { in: ids } }, select: { id: true, hash: true, moduleId: true } })).map(row => [row.id, row]));
  const approvals = new Map((await db.approval.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, title: true, moduleId: true } })).map(row => [row.id, row]));
  return { rows: rows.map(row => {
    const version = row.subjectId ? versions.get(row.subjectId) : undefined, approval = row.subjectId ? approvals.get(row.subjectId) : undefined;
    const moduleId = approval?.moduleId ?? version?.moduleId ?? row.subjectId;
    return { id: row.id, at: row.createdAt.toISOString(), kind: row.kind, subject: row.subjectId, module: moduleId ? modules.get(moduleId) ?? null : null,
      hash: version?.hash ?? null, approvalTitle: approval ? redactSensitiveText(approval.title, 4000) : null, details: detailsView(row.details, row.kind) };
  }), before: rows.length === 200 ? rows.at(-1)!.createdAt.toISOString() : null };
}

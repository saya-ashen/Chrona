import { moduleManifestSchema } from "@chrona/contracts/steward";
import { CallError, type Caller, type Json, type SystemTool, type Tool } from "../module-calls";
import type { StewardPorts } from "../ports";
import { isOwnerCaller } from "../module-owner";

type Properties = Tool["parameters"]["properties"];
export const tool = (name: string, description: string, properties: Properties, required: string[], extra: Partial<SystemTool> = {}): SystemTool =>
  ({ name, description, parameters: { type: "object", properties, required }, visibility: ["modules"], idempotent: false, ...extra });
export const text = (description?: string) => ({ type: "string" as const, ...(description ? { description } : {}) });
/** Module identity for operations scoped to the caller's own resources. */
export function entry(caller: Caller) {
  if (caller.kind !== "module") throw new CallError("forbidden", "Only an entry module may call this");
  return caller;
}
export async function requireOwner(db: Parameters<typeof isOwnerCaller>[0], workspaceId: string, caller: Caller) {
  if ((caller.kind !== "owner" && caller.kind !== "module") || !await isOwnerCaller(db, workspaceId, caller)) throw new CallError("forbidden", "Only an owner may manage this resource");
  return caller;
}
export const json = (value: unknown) => (value === undefined ? null : JSON.parse(JSON.stringify(value))) as Json;
/** Structured arguments travel as JSON text (tool parameters are scalars). */
export function parsed(value: unknown, name: string) {
  try { return JSON.parse(String(value)) as unknown; } catch { throw new CallError("invalid", `${name} must be JSON`); }
}
export async function callerManifest(db: StewardPorts["db"], caller: Extract<Caller, { kind: "module" }>) {
  const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: caller.moduleId, hash: caller.hash } } });
  return moduleManifestSchema.safeParse(version?.manifest).data ?? null;
}
export const usesAll = async (db: StewardPorts["db"], caller: Extract<Caller, { kind: "module" }>) => (await callerManifest(db, caller))?.uses.includes("*") ?? false;

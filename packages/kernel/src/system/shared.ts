import { moduleManifestSchema } from "@chrona/contracts/steward";
import { CallError } from "../modules/module-call-error";
import type { Caller, Json } from "../modules/module-call-types";
import type { StewardPorts } from "../ports";
import { isOwnerCaller } from "../modules/module-owner";

export { tool } from "./tool-declaration";
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
export async function callerManifest(db: StewardPorts["db"], caller: Extract<Caller, { kind: "module" }>) {
  const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: caller.moduleId, hash: caller.hash } } });
  return moduleManifestSchema.safeParse(version?.manifest).data ?? null;
}

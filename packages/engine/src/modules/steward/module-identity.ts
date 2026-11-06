import type { Prisma } from "@chrona/db";
import { BUILTIN_MODULE_NAMES, KERNEL_MODULE_NAMES, RESERVED_ENTRY_NAMES, type ModuleCapabilities, type ModuleOperation, type ModuleOrigin } from "@chrona/contracts/steward";
import { StewardError } from "./errors";

const kernelNames = new Set<string>(KERNEL_MODULE_NAMES);
const builtinNames = new Set<string>(BUILTIN_MODULE_NAMES);
export const isReservedModuleName = (name: string) => kernelNames.has(name) || builtinNames.has(name) || (RESERVED_ENTRY_NAMES as readonly string[]).includes(name);
/** For persisted apps ONLY Module.builtin decides origin; source/manifest/hash never do. */
export function moduleIdentity(row: { name: string; builtin: boolean }, options: { configurable?: boolean; removable?: boolean } = {}) {
  const origin: ModuleOrigin = row.builtin ? "builtin" : "external";
  return { origin, capabilities: moduleCapabilities(origin, options) };
}
export function moduleCapabilities(origin: ModuleOrigin, options: { configurable?: boolean; removable?: boolean } = {}): ModuleCapabilities {
  const external = origin === "external", app = origin !== "kernel";
  return {
    build: external, propose: external, group: external, activate: external, update: external, rollback: external,
    remove: external && options.removable !== false, install: false,
    enable: app, disable: app, configure: options.configurable === true, diagnose: app,
  };
}
export class ModuleIdentityError extends StewardError {
  constructor(code: "forbidden" | "conflict", public readonly reason: "immutable_module" | "reserved_module_name" | "module_identity_conflict", message: string) { super(code, message); }
}
const dynamic = new Set<ModuleOperation>(["build", "propose", "group", "activate", "update", "rollback", "remove", "install"]);
/** Guard again inside the action/approval transaction. Trusted release activation must not call this dynamic guard. */
export function assertModuleOperation(row: { name: string; builtin: boolean }, operation: ModuleOperation) {
  if (!row.builtin && isReservedModuleName(row.name)) throw new ModuleIdentityError("conflict", "module_identity_conflict", `Module ${row.name} conflicts with a reserved identity`);
  if (dynamic.has(operation) && row.builtin) throw new ModuleIdentityError("forbidden", "immutable_module", `Built-in ${row.name} cannot ${operation}; update Chrona instead`);
}
export async function assertExternalModule(tx: Prisma.TransactionClient, workspaceId: string, moduleId: string, operation: ModuleOperation) {
  const row = await tx.module.findFirst({ where: { workspaceId, id: moduleId } });
  if (!row) throw new StewardError("not_found", "Module not found");
  assertModuleOperation(row, operation);
  return row;
}
/** New names are checked before any row/candidate is created, including an empty workspace. */
export async function assertExternalName(tx: Prisma.TransactionClient, workspaceId: string, name: string, operation: ModuleOperation) {
  if (isReservedModuleName(name)) throw new ModuleIdentityError("forbidden", "reserved_module_name", `Module name ${name} is reserved by Chrona`);
  const row = await tx.module.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
  if (row) assertModuleOperation(row, operation);
  return row;
}

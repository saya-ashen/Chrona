import type { Prisma } from "@chrona/db";
import { BUILTIN_MODULE_NAMES, KERNEL_MODULE_NAMES, LOCAL_CAPABILITY_NAMES, RESERVED_ENTRY_NAMES, type ModuleCapabilities, type ModuleOperation, type ModuleOrigin } from "@chrona/contracts/steward";
import { StewardError } from "./errors";

const kernelNames = new Set<string>(KERNEL_MODULE_NAMES);
const builtinNames = new Set<string>(BUILTIN_MODULE_NAMES);
export const isReservedModuleName = (name: string) => kernelNames.has(name) || builtinNames.has(name) || (LOCAL_CAPABILITY_NAMES as readonly string[]).includes(name) || (RESERVED_ENTRY_NAMES as readonly string[]).includes(name);
/** For persisted apps ONLY Module.builtin decides origin; source/manifest/hash never do. */
export function moduleIdentity(row: { name: string; builtin: boolean }, options: { configurable?: boolean; removable?: boolean } = {}) {
  const origin: ModuleOrigin = row.builtin ? "builtin" : "external";
  return { origin, capabilities: moduleCapabilities(origin, options) };
}
export function moduleCapabilities(origin: ModuleOrigin, options: { configurable?: boolean; removable?: boolean } = {}): ModuleCapabilities {
  const external = origin === "external", app = origin !== "kernel";
  return {
    build: app, propose: app, group: app, activate: app, update: app, rollback: app,
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
  if (kernelNames.has(row.name) || (LOCAL_CAPABILITY_NAMES as readonly string[]).includes(row.name) || (RESERVED_ENTRY_NAMES as readonly string[]).includes(row.name) || (!row.builtin && builtinNames.has(row.name))) throw new ModuleIdentityError("conflict", "module_identity_conflict", `Module ${row.name} conflicts with a reserved identity`);
  if (dynamic.has(operation) && row.builtin && (!builtinNames.has(row.name) || operation === "remove" || operation === "install")) throw new ModuleIdentityError("forbidden", "immutable_module", `Built-in ${row.name} cannot ${operation}`);
}
export async function assertExternalModule(tx: Prisma.TransactionClient, workspaceId: string, moduleId: string, operation: ModuleOperation) {
  const row = await tx.module.findFirst({ where: { workspaceId, id: moduleId } });
  if (!row) throw new StewardError("not_found", "Module not found");
  assertModuleOperation(row, operation);
  return row;
}
/** New names are checked before any row/candidate is created, including an empty workspace. */
export async function assertExternalName(tx: Prisma.TransactionClient, workspaceId: string, name: string, operation: ModuleOperation) {
  const row = await tx.module.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
  if (isReservedModuleName(name) && !(row?.builtin && builtinNames.has(name))) throw new ModuleIdentityError("forbidden", "reserved_module_name", `Module name ${name} is reserved by Chrona`);
  if (row) assertModuleOperation(row, operation);
  return row;
}

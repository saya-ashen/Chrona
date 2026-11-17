import type { Prisma } from "@chrona/db";
import { KERNEL_MODULE_NAMES, LOCAL_CAPABILITY_NAMES, type ModuleCapabilities, type ModuleOperation, type ModuleOrigin } from "@chrona/contracts/steward";
import { StewardError } from "../errors";

const kernelNames = new Set<string>(KERNEL_MODULE_NAMES);
const isKernelReservedName = (name: string) => kernelNames.has(name) || (LOCAL_CAPABILITY_NAMES as readonly string[]).includes(name);
export function moduleIdentity(_row: { name: string }, options: { configurable?: boolean; removable?: boolean } = {}) {
  const origin: ModuleOrigin = "external";
  const capabilities = moduleCapabilities(origin, options);
  return { origin, capabilities };
}
export function moduleCapabilities(origin: ModuleOrigin, options: { configurable?: boolean; removable?: boolean } = {}): ModuleCapabilities {
  const app = origin !== "kernel";
  return {
    build: app, propose: app, activate: app, update: app, rollback: app,
    remove: app && options.removable !== false, install: false,
    enable: app, disable: app, configure: options.configurable === true, diagnose: app,
  };
}
export class ModuleIdentityError extends StewardError {
  constructor(code: "forbidden" | "conflict", public readonly reason: "reserved_module_name" | "module_identity_conflict", message: string) { super(code, message); }
}
/** Recheck reserved identities inside the action/approval transaction. */
export function assertModuleOperation(row: { name: string }, operation: ModuleOperation) {
  if (isKernelReservedName(row.name)) throw new ModuleIdentityError("conflict", "module_identity_conflict", `Module ${row.name} cannot ${operation}: reserved identity`);
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
  if (isKernelReservedName(name)) throw new ModuleIdentityError("forbidden", "reserved_module_name", `Module name ${name} is reserved by Chrona`);
  if (row) assertModuleOperation(row, operation);
  return row;
}

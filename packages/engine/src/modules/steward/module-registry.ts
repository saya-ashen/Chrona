import type { SystemModule } from "./module-system-types";
import type { StewardPorts } from "./ports";

export const systemModules = new Map<string, SystemModule>();
export const localModules = new Map<string, SystemModule>();
export const injectedModules = new WeakMap<object, Map<string, SystemModule>>();
/** Trusted release modules share the router; their state belongs to each runtime, never this registry. */
export function registerLocalModule(module: SystemModule, database?: StewardPorts["db"]) {
  if (systemModules.has(module.name)) throw new Error(`Local module conflicts with kernel interface ${module.name}`);
  if (!database) { localModules.set(module.name, module); return; }
  let injected = injectedModules.get(database);
  if (!injected) { injected = new Map(); injectedModules.set(database, injected); }
  injected.set(module.name, module);
}
export function registerSystemModule(module: SystemModule) {
  if (localModules.has(module.name)) throw new Error(`Kernel interface conflicts with local module ${module.name}`);
  systemModules.set(module.name, module);
}
/** System modules and their tools, for catalogs (v2-13: the Provider reaches those visible to it). */
export const listSystemModules = () => [...systemModules.values()];
/** Read-only discovery does not change kernel-only tool admission. */
export const listLocalModules = () => [...localModules.values()];

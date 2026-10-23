import type { StewardPorts } from "./ports";

// Readiness lives in memory: channel modules are keepAlive and report it again after every start.
const ready = new WeakMap<StewardPorts["db"], Map<string, boolean>>();
export function setChannelReady(ports: StewardPorts, moduleId: string, value: boolean) {
  let modules = ready.get(ports.db);
  if (!modules) { modules = new Map(); ready.set(ports.db, modules); }
  modules.set(moduleId, value);
}
export const channelReady = (ports: StewardPorts, moduleId: string) => ready.get(ports.db)?.get(moduleId) ?? false;

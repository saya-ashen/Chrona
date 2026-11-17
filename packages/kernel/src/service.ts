import type { StewardPorts } from "./ports";
import { createApprovals } from "./approvals";
import { createModules, isModuleApproval } from "./modules/modules";
import { createTools } from "./tools";
import { createSettings } from "./settings";
import { createRuns } from "./execution/runs";
import { createTick } from "./tick";
import { createProviderControl } from "./agent/provider-channel";
import { registerSystemModules } from "./system-modules";
import { registerLocalRuntime } from "./execution/local-runtime";
// Registers what modules' own calls do with the supervisor (see module-supervisor).
import "./modules/module-effects";
/** Authenticated owner boundary. */
export function createStewardService(inputPorts: StewardPorts) {
  registerSystemModules();
  // Agent project/configuration admission is needed even before a Provider operation runs.
  registerLocalRuntime();
  const ports: StewardPorts = Object.create(inputPorts);
  const tick = createTick(ports);
  return { tools: createTools(ports), tick, forWorkspace(workspaceId: string) {
    const ctx = { db: ports.db, workspaceId, now: ports.now };
    const modules = createModules(ports, workspaceId);
    const approvals = createApprovals(ctx, async action => {
      if (isModuleApproval(action.payload)) await modules.onApproved(action);
      else await ports.onApproved?.(action);
    }, ports);
    return { provider: createProviderControl(ports, workspaceId), runs: createRuns(ports, workspaceId), modules, approvals, settings: createSettings(ctx) };
  } };
}
export type StewardService = ReturnType<typeof createStewardService>;

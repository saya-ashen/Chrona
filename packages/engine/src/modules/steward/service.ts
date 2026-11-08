import type { StewardPorts } from "./ports";
import { createApprovals } from "./approvals";
import { createModules, isModuleApproval } from "./modules";
import { createTools } from "./tools";
import { createGrants } from "./grants";
import { createSettings } from "./settings";
import { createSchedules } from "./schedules";
import { createRuns } from "./runs";
import { createTick } from "./tick";
import { createProviderControl } from "./provider-channel";
import { registerSystemModules } from "./system-modules";
// Registers what modules' own calls do with the supervisor (see module-supervisor).
import "./module-effects";
/** Authenticated owner boundary. */
export function createStewardService(inputPorts: StewardPorts) {
  registerSystemModules();
  const ports: StewardPorts = Object.create(inputPorts);
  const tick = createTick(ports);
  return { tools: createTools(ports), tick, forWorkspace(workspaceId: string) {
    const ctx = { db: ports.db, workspaceId, now: ports.now };
    const modules = createModules(ports, workspaceId);
    const approvals = createApprovals(ctx, async action => {
      if (isModuleApproval(action.payload)) await modules.onApproved(action);
      else await ports.onApproved?.(action);
    }, ports);
    return { provider: createProviderControl(ports, workspaceId), schedules: createSchedules(ports, workspaceId), runs: createRuns(ports, workspaceId), modules, approvals, grants: createGrants(ctx), settings: createSettings(ctx) };
  } };
}
export type StewardService = ReturnType<typeof createStewardService>;

import { delegateAgent } from "./agent-delegation";
import { installAgentDelegation } from "./agent-delegation-port";
import { registerSystemModule } from "./module-calls";
import { approvals } from "./system/approvals";
import { modules } from "./system/modules";
import { settings } from "./system/settings";
import { schedules } from "./system/schedules";
import { secrets } from "./system/secrets";
import { activity } from "./system/activity";
import { projects } from "./system/projects";

let registered = false;
/** Called by the service: Chrona's system modules become routable call targets. */
export function registerSystemModules() {
  if (registered) return;
  installAgentDelegation(delegateAgent);
  registered = true; [approvals, modules, settings, schedules, secrets, activity, projects].forEach(registerSystemModule);
}

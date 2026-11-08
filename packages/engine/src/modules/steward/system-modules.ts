import { delegateAgent } from "./agent-delegation";
import { injectedAgentTools, injectedAgentPrimitive } from "./agent-injected";
import { installInjectedAgent, installAgentDelegation } from "./agent-delegation-port";
import { registerSystemModule } from "./module-calls";
import { history } from "./system/history";
import { approvals } from "./system/approvals";
import { modules } from "./system/modules";
import { settings } from "./system/settings";
import { schedules } from "./system/schedules";
import { secrets } from "./system/secrets";
import { activity } from "./system/activity";
import { content } from "./system/content";
import { memory } from "./memory";

let registered = false;
/** Called by the service: Chrona's system modules become routable call targets. */
export function registerSystemModules() {
  if (registered) return;
  installAgentDelegation(delegateAgent);
  installInjectedAgent(injectedAgentTools, injectedAgentPrimitive);
  registered = true; [history, approvals, modules, settings, schedules, secrets, activity, content, memory].forEach(registerSystemModule);
}

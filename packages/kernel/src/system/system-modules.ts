import { timers } from "./timers";
import { agent } from "./agent";
import { registerSystemModule } from "../modules/module-calls";
import { approvals } from "./approvals";
import { modules } from "./modules";
import { settings } from "./settings";
import { secrets } from "./secrets";
import { activity } from "./activity";

let registered = false;
/** Called by the service: Chrona's system modules become routable call targets. */
export function registerSystemModules() {
  if (registered) return;
  registered = true; [approvals, modules, settings, secrets, activity, timers, agent].forEach(registerSystemModule);
}

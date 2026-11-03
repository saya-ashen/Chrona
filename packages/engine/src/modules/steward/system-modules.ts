import { registerSystemModule } from "./module-calls";
import { chat } from "./system/chat";
import { approvals } from "./system/approvals";
import { modules } from "./system/modules";
import { settings } from "./system/settings";
import { schedules } from "./system/schedules";
import { ai } from "./system/provider";
import { secrets } from "./system/secrets";
import { activity } from "./system/activity";
import { content } from "./system/content";
import { reflection } from "./reflection";
import { memory } from "./memory";

let registered = false;
/** Called by the service: Chrona's system modules become routable call targets. */
export function registerSystemModules() {
  if (registered) return;
  registered = true; [chat, approvals, modules, settings, schedules, ai, secrets, activity, content, reflection, memory].forEach(registerSystemModule);
}

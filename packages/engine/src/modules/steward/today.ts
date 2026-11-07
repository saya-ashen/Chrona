import { todayViewSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { callSync, kernelOrigin, type CallOrigin } from "./module-calls";
import { runtimeHealth } from "./runtime-health";
import { createNotificationsView } from "./notify-user";

/** Compatibility facade. The web application owns overview composition; the runtime exposes facts only. */
export function workspaceToday(ports: StewardPorts, workspaceId: string, governance: Pick<CallOrigin, "deadline" | "run"> = {}) {
  return {
    get: async () => todayViewSchema.parse((await callSync(ports, { ...kernelOrigin(workspaceId), ...governance }, "web.today", {})).output),
    health: async () => {
      const [{ at: _at, ...runtime }, notifications] = await Promise.all([runtimeHealth(ports, workspaceId), createNotificationsView(ports, workspaceId).status()]);
      return { ...runtime, queuedNotifications: notifications?.queued ?? 0, failedNotifications: notifications?.failed ?? 0 };
    },
  };
}

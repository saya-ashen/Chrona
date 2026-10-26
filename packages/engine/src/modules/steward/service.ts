import { createSessions } from "./sessions";
import type { StewardPorts } from "./ports";
import { createApprovals } from "./approvals";
import { createModules } from "./modules";
import { createTools } from "./tools";
import { createGrants } from "./grants";
import { createPreferences } from "./preferences";
import { createSettings } from "./settings";
import { createNotificationsView, forwardSettings } from "./notify-user";
import { workspaceToday } from "./today";
import { createSchedules } from "./schedules";
import { createRuns } from "./runs";
import { createTick } from "./tick";
import { createChat } from "./chat";
import { createProviderControl } from "./provider-channel";
import { registerSystemModules } from "./system-modules";
/** Authenticated owner boundary. */
export function createStewardService(inputPorts: StewardPorts) {
  registerSystemModules();
  const ports: StewardPorts = Object.create(inputPorts);
  const tick = createTick(ports);
  const chat = createChat(ports, () => ports.onQueued ? ports.onQueued() : tick());
  ports.onRunFinished = async (workspaceId, runId) => {
    await chat.runFinished(workspaceId, runId);
    await inputPorts.onRunFinished?.(workspaceId, runId);
  };
  return { chat, tools: createTools(ports), tick, forWorkspace(workspaceId: string) {
    const ctx = { db: ports.db, workspaceId, now: ports.now };
    const modules = createModules(ports, workspaceId);
    const approvals = createApprovals(ctx, async action => {
      const payload = action.payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.kind === "activate_module") await modules.onApproved(action);
      else await ports.onApproved?.(action);
    }, ports);
    const notifications = createNotificationsView(ports, workspaceId);
    const projection = workspaceToday(ports, workspaceId);
    return { sessions: createSessions(ports, workspaceId), provider: createProviderControl(ports, workspaceId), chat: { handleMessage: (input: Omit<import("./chat").ChatInput, "workspaceId">) => chat.handleMessage({ ...input, workspaceId }), messages: (limit?: number, sessionId?: string) => chat.messages(workspaceId, limit, sessionId), recordMessage: (input: Parameters<typeof chat.recordMessage>[1]) => chat.recordMessage(workspaceId, input), setExternalId: (id: string, externalId: string) => chat.setExternalId(workspaceId, id, externalId) }, schedules: createSchedules(ports, workspaceId), runs: createRuns(ports, workspaceId), modules, approvals, grants: createGrants(ctx), preferences: createPreferences(ctx), settings: createSettings(ctx, { status: notifications.status, forward: (tx, settings, at) => forwardSettings(tx, ports, workspaceId, settings, at) }), notifications, today: projection.get, health: projection.health };
  } };
}
export type StewardService = ReturnType<typeof createStewardService>;

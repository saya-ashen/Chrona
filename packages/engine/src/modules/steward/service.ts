import { createContent } from "./content";
import { createApps } from "./apps";
import { createSessions } from "./sessions";
import type { StewardPorts } from "./ports";
import { createApprovals } from "./approvals";
import { createModules } from "./modules";
import { createTools } from "./tools";
import { createGrants } from "./grants";
import { createPreferences } from "./preferences";
import { createSettings } from "./settings";
import { createNotifications } from "./notify";
import { createToday } from "./today";
import { createSchedules } from "./schedules";
import { createRuns } from "./runs";
import { createTick } from "./tick";
import { createChat } from "./chat";
import { createConnectors } from "./connectors";
import { createProviderControl } from "./provider-channel";
/** Authenticated owner boundary. */
export function createStewardService(inputPorts: StewardPorts) {
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
    const apps = createApps(ports, workspaceId);
    const approvals = createApprovals(ctx, async action => {
      const payload = action.payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.kind === "activate_module") await modules.onApproved(action);
      else await ports.onApproved?.(action);
    });
    const projection = createToday(ctx, {
      async provider() {
        if (!ports.provider) return { name: "unconfigured", available: false, sandboxed: false, lastError: null };
        try { const h = await ports.provider.health(); return { name: ports.provider.name, available: h.available, sandboxed: h.sandboxed, lastError: h.error?.slice(0, 500) ?? null }; }
        catch { return { name: ports.provider.name, available: false, sandboxed: false, lastError: "Provider health check failed" }; }
      },
      moduleSandbox: () => ports.sandbox?.isolated ?? false,
    }, apps.list);
    return { apps, sessions: createSessions(ports, workspaceId), content: createContent(ports, workspaceId, chat.submit), provider: createProviderControl(ports, workspaceId), connectors: createConnectors(ports, workspaceId), chat: { handleMessage: (input: Omit<import("./chat").ChatInput, "workspaceId">) => chat.handleMessage({ ...input, workspaceId }), messages: (limit?: number, sessionId?: string) => chat.messages(workspaceId, limit, sessionId),
      intakeAttachment: (file: { name: string; mime: string; bytes: Uint8Array }) => chat.intakeAttachments({ workspaceId, channel: "in_app" }, [file]).then(result => result.attachments[0]!),
      runReplies: (runId: string) => chat.runReplies(workspaceId, runId), recordMessage: (input: Parameters<typeof chat.recordMessage>[1]) => chat.recordMessage(workspaceId, input), setExternalId: (id: string, externalId: string) => chat.setExternalId(workspaceId, id, externalId) }, schedules: createSchedules(ports, workspaceId), runs: createRuns(ports, workspaceId), modules, approvals, grants: createGrants(ctx), preferences: createPreferences(ctx), settings: createSettings(ctx, ports.chat), notifications: createNotifications(ports, workspaceId), today: projection.get, health: projection.health };
  } };
}
export type StewardService = ReturnType<typeof createStewardService>;

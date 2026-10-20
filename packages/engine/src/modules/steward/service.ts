import { createUiEvents } from "./ui";
import type { StewardPorts } from "./ports";
import { createAffairs } from "./affairs";
import { createApprovals } from "./approvals";
import { createModules } from "./modules";
import { createTools } from "./tools";
import { createGrants } from "./grants";
import { createPreferences } from "./preferences";
import { createSettings } from "./settings";
import { createNotifications } from "./notify";
import { createToday } from "./today";
import { createWorkspaceFs } from "./workspace-fs";
import { createSchedules } from "./schedules";
import { createRuns } from "./runs";
import { createTick } from "./tick";
import { createChat } from "./chat";
import { createConnectors } from "./connectors";
import { createProviderControl } from "./provider-channel";
/** Authenticated owner boundary. */
export function createStewardService(inputPorts: StewardPorts) {
  const ports: StewardPorts = Object.create(inputPorts);
  const fs = createWorkspaceFs(ports.dataDir);
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
    });
    const projection = createToday(ctx, fs, {
      async provider() {
        if (!ports.provider) return { name: "unconfigured", available: false, sandboxed: false, lastError: null };
        try { const h = await ports.provider.health(); return { name: ports.provider.name, available: h.available, sandboxed: h.sandboxed, lastError: h.error?.slice(0, 500) ?? null }; }
        catch { return { name: ports.provider.name, available: false, sandboxed: false, lastError: "Provider health check failed" }; }
      },
      git: ports.gitHealth ?? (async () => {
        try { return await Bun.spawn(["git", "--version"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited === 0; } catch { return false; }
      }),
      moduleSandbox: () => ports.sandbox?.available ?? false,
    });
    return { provider: createProviderControl(ports, workspaceId), uiEvent: createUiEvents(ctx, chat.submit), connectors: createConnectors(ports, workspaceId), chat: { handleMessage: (input: Omit<import("./chat").ChatInput, "workspaceId">) => chat.handleMessage({ ...input, workspaceId }), messages: (limit?: number) => chat.messages(workspaceId, limit) }, schedules: createSchedules(ports, workspaceId), runs: createRuns(ports, workspaceId), affairs: createAffairs(ctx, fs), modules, approvals, grants: createGrants(ctx), preferences: createPreferences(ctx), settings: createSettings(ctx, ports.chat), notifications: createNotifications(ports, workspaceId), today: projection.get, health: projection.health };
  } };
}
export type StewardService = ReturnType<typeof createStewardService>;

import type { PrismaClient } from "@chrona/db";
import type { ConnectorAdapter, DeliveryAdapter, ProviderAdapter } from "@chrona/contracts/steward";
import { createAffairs } from "./affairs";
import { createApprovals, type OnApproved } from "./approvals";
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
export type StewardPorts = {
  db: PrismaClient; now(): Date; dataDir: string; publicUrl: string | null;
  deliveries: DeliveryAdapter[];
  chat: { channel: "chrona_qqbot"; bound(): Promise<boolean> } | null;
  provider?: ProviderAdapter;
  chatTimeoutMs?: number;
  onQueued?: () => Promise<unknown>;
  onRunFinished?: (workspaceId: string, runId: string) => Promise<void>;
  onApproved?: OnApproved;
  connectors?: ConnectorAdapter[];
  sandbox?: { available: boolean; run?(input: { command: string; cwd: string; timeoutMs: number; maxOutputBytes: number }): Promise<{ output: string; exitCode: number }> };
  gitHealth?: () => Promise<boolean>;
};
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
    const projection = createToday(ctx, fs, {
      async provider() {
        if (!ports.provider) return { name: "unconfigured", available: false, sandboxed: false, lastError: null };
        try { const h = await ports.provider.health(); return { name: ports.provider.name, available: h.available, sandboxed: h.sandboxed, lastError: h.error?.slice(0, 500) ?? null }; }
        catch { return { name: ports.provider.name, available: false, sandboxed: false, lastError: "Provider health check failed" }; }
      },
      git: ports.gitHealth ?? (async () => {
        try { return await Bun.spawn(["git", "--version"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited === 0; } catch { return false; }
      }),
      jobsSandbox: () => ports.sandbox?.available ?? false,
    });
    return { connectors: createConnectors(ports, workspaceId), chat: { handleMessage: (input: Omit<import("./chat").ChatInput, "workspaceId">) => chat.handleMessage({ ...input, workspaceId }), messages: (limit?: number) => chat.messages(workspaceId, limit) }, schedules: createSchedules(ports, workspaceId), runs: createRuns(ports, workspaceId), affairs: createAffairs(ctx, fs), approvals: createApprovals(ctx, ports.onApproved), grants: createGrants(ctx), preferences: createPreferences(ctx), settings: createSettings(ctx, ports.chat), notifications: createNotifications(ports, workspaceId), today: projection.get, health: projection.health };
  } };
}
export type StewardService = ReturnType<typeof createStewardService>;

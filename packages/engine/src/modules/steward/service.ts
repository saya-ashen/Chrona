import type { PrismaClient } from "@chrona/db";
import type { SourceAdapter, Assessor, DeliveryAdapter, Health, EntryActor } from "@chrona/contracts/steward";
import { createAffairs } from "./affairs";
import { createAsks } from "./asks";
import { createGrants } from "./grants";
import { createPreferences } from "./preferences";
import { createSettings } from "./settings";
import { createChatLog } from "./chat-log";
import { createToday } from "./today";
import { createNotifications } from "./notify";
import { createConnections } from "./sources";
import { createTick } from "./tick";
import { createRuns } from "./runs";
import { createAgentTools } from "./agent-tools";
import { createConcierge } from "./concierge";
import { createManagedTools } from "./managed-tools";
export type StewardActor = EntryActor;
export type StewardPorts = {
  db: PrismaClient; now(): Date; publicUrl: string | null;
  sources: SourceAdapter[]; assessor: Assessor; deliveries: DeliveryAdapter[];
  chat: { channel: "chrona_qqbot"; bound(): Promise<boolean> } | null;
  agentHealth(): Health["agent"];
  sandbox?: {
    health: Health["sandbox"];
    run(input: { language: "python" | "shell" | "typescript"; source: string; input: unknown }): Promise<{ status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null }>;
  };
  agent: {
    runAffair(input: { runId: string; token: string; affairId: string; deadline: Date }): Promise<void>;
    runConcierge(input: { runId: string; token: string; deadline: Date }): Promise<void>;
  } | null;
};
/** Trusted application boundary: routes authenticate the owner before selecting a workspace. */
export function createStewardService(ports: StewardPorts) {
  const concierge = createConcierge(ports), tools = createAgentTools(ports), runs = createRuns(ports);
  const agentEndpoint = {
    async catalog(token: string) {
      if (concierge.owns(token)) return concierge.catalog(token);
      await runs.authenticate(token); return tools.catalog();
    },
    callTool: (token: string, name: string, raw: unknown) => concierge.owns(token) ? concierge.conciergeCallTool(token, name, raw) : tools.callTool(token, name, raw),
    webPreflight: (token: string, raw: unknown) => concierge.owns(token) ? concierge.webPreflight(token, raw) : tools.webPreflight(token, raw),
    webObserved: (token: string, raw: unknown) => concierge.owns(token) ? concierge.webObserved(token, raw) : tools.webObserved(token, raw),
  };
  return { chat: concierge, agentEndpoint, runs, agentTools: () => tools, tick: createTick(ports), forWorkspace(workspaceId: string) {
    const ctx = { db: ports.db, workspaceId, now: ports.now }, projection = createToday(ctx, ports.agentHealth, () => ports.sandbox?.health ?? { available: false, languages: [] });
    async function health() {
      const value = await projection.health();
      const state = await ports.db.stewardState.findUnique({ where: { workspaceId } });
      if (state?.agentLastError === "Assessor unavailable") value.agent = { available: false, name: state.agentName, lastError: state.agentLastError };
      return value;
    }
    return { chat: { handleMessage: (input: Omit<Parameters<typeof concierge.handleMessage>[0], "workspaceId">) => concierge.handleMessage({ ...input, workspaceId }), messages: (limit?: number) => concierge.messages(workspaceId, limit) }, affairs: createAffairs(ctx), tools: createManagedTools(ctx), asks: createAsks(ctx), grants: createGrants(ctx), preferences: createPreferences(ctx), settings: createSettings(ctx, ports.chat), chatLog: createChatLog(ctx), notifications: createNotifications(ports, workspaceId), connections: createConnections(ports, workspaceId), today: async () => ({ ...await projection.get(), health: await health() }), health };
  } };
}
export type StewardService = ReturnType<typeof createStewardService>;

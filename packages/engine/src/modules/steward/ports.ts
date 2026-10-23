import type { Prisma, PrismaClient } from "@chrona/db";
import type { ConnectorAdapter, DeliveryAdapter, ProviderAdapter, moduleCallReplySchema } from "@chrona/contracts/steward";
type OwnerReply = Extract<Extract<ReturnType<typeof moduleCallReplySchema.parse>, { result: unknown }>["result"], { body: unknown }>;
/** Only trusted owner routes may resolve. The caller executes the returned payload,
 * rechecking policy and atomically consuming a once grant with its action claim. */
export type ApprovedAction = { workspaceId: string; approvalId: string; grantId: string; payload: Prisma.JsonValue };
/** V5 seam: the executor must claim idempotently, recheck policy, consume once grants,
 * and record delivery outcomes. A resolved approval alone never means sent. */
export type OnApproved = (action: ApprovedAction) => Promise<void>;

export type StewardPorts = {
  db: PrismaClient; now(): Date; dataDir: string; publicUrl: string | null;
  deliveries: DeliveryAdapter[];
  chat: { channel: "chrona_qqbot"; bound(): Promise<boolean> } | null;
  provider?: ProviderAdapter;
  modelGateway?: {
    complete(input: { model: string; system?: string; prompt: string; maxOutputTokens: number; timeoutMs: number }): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }>;
  };
  /** Kernel-held credentials for modules declaring them in `secrets` (e.g. qq_bot: { appId, clientSecret }). */
  secrets?(name: string): Promise<Record<string, string> | null>;
  /** Owner API for entry modules (v2-4): one request of the HTTP map, as the user. */
  owner?(workspaceId: string, request: { method: string; path: string; body?: unknown }): Promise<OwnerReply>;
  /** The `chrona` SDK package directory (sdk.ts, testing.ts) given to module builds. */
  moduleSdk?: string;
  moduleBuiltinResources?: string;
  chatTimeoutMs?: number;
  onQueued?: () => Promise<unknown>;
  onRunFinished?: (workspaceId: string, runId: string) => Promise<void>;
  onApproved?: OnApproved;
  connectors?: ConnectorAdapter[];
  sandbox?: {
    /** Modules can run (an interpreter exists). */
    available: boolean;
    /** Modules run inside bubblewrap; otherwise as plain processes of the Chrona user (declared limits are not enforced). */
    isolated: boolean;
    startModule?(input: { codeDir: string; dataDir: string; contentDir?: string; httpDir?: string; env?: Record<string, string>; entry: string; socketPath: string; network?: boolean }): { pid: number; exited: Promise<{ code: number | null; signal: string | null }>; stderr(): string; kill(): void };
    runModule?(input: { codeDir: string; dataDir: string; contentDir?: string; entry: string; input: unknown; network?: boolean; timeoutMs?: number; maxOutputBytes?: number }): Promise<{ status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null; exitCode?: number }>;
  };

  gitHealth?: () => Promise<boolean>;
};

import type { Prisma, PrismaClient } from "@chrona/db";
import type { ConnectorAdapter, DeliveryAdapter, ProviderAdapter } from "@chrona/contracts/steward";
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
  moduleBuildResources?: { sdk: string; testing: string };
  moduleBuiltinResources?: string;
  chatTimeoutMs?: number;
  onQueued?: () => Promise<unknown>;
  onRunFinished?: (workspaceId: string, runId: string) => Promise<void>;
  onApproved?: OnApproved;
  connectors?: ConnectorAdapter[];
  sandbox?: {
    available: boolean;
    startModule?(input: { codeDir: string; dataDir: string; contentDir?: string; entry: string; socketPath: string; network?: boolean }): { pid: number; exited: Promise<{ code: number | null; signal: string | null }>; stderr(): string; kill(): void };
    run?(input: { command: string; cwd: string; timeoutMs: number; maxOutputBytes: number }): Promise<{ output: string; exitCode: number }>;
    runModule?(input: { codeDir: string; dataDir: string; contentDir?: string; entry: string; input: unknown; network?: boolean; timeoutMs?: number; maxOutputBytes?: number }): Promise<{ status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null; exitCode?: number }>;
  };
  gitHealth?: () => Promise<boolean>;
};

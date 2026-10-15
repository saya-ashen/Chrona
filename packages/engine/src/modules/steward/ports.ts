import type { PrismaClient } from "@chrona/db";
import type { ConnectorAdapter, DeliveryAdapter, ProviderAdapter } from "@chrona/contracts/steward";
import type { OnApproved } from "./approvals";

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

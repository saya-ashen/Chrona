import type { PrismaClient } from "@chrona/db";
import type { ConnectorAdapter, DeliveryAdapter, ProviderAdapter } from "@chrona/contracts/steward";
import type { OnApproved } from "./approvals";

export type StewardPorts = {
  db: PrismaClient; now(): Date; dataDir: string; publicUrl: string | null;
  deliveries: DeliveryAdapter[];
  chat: { channel: "chrona_qqbot"; bound(): Promise<boolean> } | null;
  provider?: ProviderAdapter;
  moduleBuildResources?: { sdk: string; testing: string };
  chatTimeoutMs?: number;
  onQueued?: () => Promise<unknown>;
  onRunFinished?: (workspaceId: string, runId: string) => Promise<void>;
  onApproved?: OnApproved;
  connectors?: ConnectorAdapter[];
  sandbox?: {
    available: boolean;
    startModule?(input: { codeDir: string; dataDir: string; entry: string; socketPath: string; network?: boolean }): { pid: number; exited: Promise<{ code: number | null; signal: string | null }>; stderr(): string; kill(): void };
    run?(input: { command: string; cwd: string; timeoutMs: number; maxOutputBytes: number }): Promise<{ output: string; exitCode: number }>;
    runModule?(input: { codeDir: string; dataDir: string; entry: string; input: unknown; network?: boolean; timeoutMs?: number; maxOutputBytes?: number }): Promise<{ status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null; exitCode?: number }>;
  };
  gitHealth?: () => Promise<boolean>;
};

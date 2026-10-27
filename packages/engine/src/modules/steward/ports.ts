import type { Prisma, PrismaClient } from "@chrona/db";
import type { ProviderAdapter } from "@chrona/contracts/steward";
/** Only trusted owner routes may resolve. The caller executes the returned payload,
 * rechecking policy and atomically consuming a once grant with its action claim. */
export type ApprovedAction = { workspaceId: string; approvalId: string; grantId: string; payload: Prisma.JsonValue };
/** V5 seam: the executor must claim idempotently, recheck policy, consume once grants,
 * and record delivery outcomes. A resolved approval alone never means sent. */
export type OnApproved = (action: ApprovedAction) => Promise<void>;

export type StewardPorts = {
  db: PrismaClient; now(): Date; dataDir: string; publicUrl: string | null;
  provider?: ProviderAdapter;
  /** Credentials from the service environment (qq_bot: { appId, clientSecret }); others are saved under `<dataDir>/secrets` (v2-16). */
  secrets?(name: string): Promise<Record<string, string> | null>;
  /** v2-6 dependency installer: lockfile libraries and host system programs, into a staging module directory. */
  packages?: {
    backend: "nix" | "system";
    install(input: { dir: string; packages: string[]; gcroot: string }): Promise<{ errors: string[]; installed: { npm: boolean; python: boolean; packages: Record<string, string[]> } }>;
  };
  /** The `chrona` SDK package directory (sdk.ts, testing.ts) given to module builds. */
  moduleSdk?: string;
  /** Trusted resources from the running release: built-in installation and development-reference checkout, never app data. */
  moduleBuiltinResources?: string;
  chatTimeoutMs?: number;
  onQueued?: () => Promise<unknown>;
  onRunFinished?: (workspaceId: string, runId: string) => Promise<void>;
  onApproved?: OnApproved;
  sandbox?: {
    /** Modules can run (an interpreter exists). */
    available: boolean;
    /** Modules run inside bubblewrap; otherwise as plain processes of the Chrona user (declared limits are not enforced). */
    isolated: boolean;
    startModule?(input: { codeDir: string; dataDir: string; contentDir?: string; httpDir?: string; env?: Record<string, string>; entry: string; socketPath: string; network?: boolean }): { pid: number; exited: Promise<{ code: number | null; signal: string | null }>; stderr(): string; kill(): void; limits?: { virtualMemoryMb: number } };
    runModule?(input: { codeDir: string; dataDir: string; contentDir?: string; entry: string; input: unknown; network?: boolean; timeoutMs?: number; maxOutputBytes?: number; memoryMb?: number }): Promise<{ status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null; exitCode?: number }>;
  };

  gitHealth?: () => Promise<boolean>;
};

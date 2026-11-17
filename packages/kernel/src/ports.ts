import type { Prisma, PrismaClient } from "@chrona/db";
import type { ModuleEntry } from "@chrona/contracts/steward";
import type { ExternalModuleInstaller } from "./modules/module-install-types";

/** Only trusted owner routes may resolve. The caller executes the returned payload,
 * rechecking policy and atomically consuming a once grant with its action claim. */
export type ApprovedAction = { workspaceId: string; approvalId: string; payload: Prisma.JsonValue };
/** V5 seam: the executor must claim idempotently, recheck policy, consume once grants,
 * and record delivery outcomes. A resolved approval alone never means sent. */
export type OnApproved = (action: ApprovedAction) => Promise<void>;

export type StewardPorts = {
  db: PrismaClient; now(): Date; dataDir: string; publicUrl: string | null;
  /** Loopback kernel HTTP origin for application-owned Provider tool bridges. */
  kernelUrl?: string;
  /** Optional host-private credential defaults, used only for approved declared reads when no saved vault value exists. */
  secrets?(name: string): Promise<Record<string, string> | null>;
  /** Presence metadata for host-owned credentials; never reads or returns credential values. */
  secretConfigured?(name: string): Promise<boolean>;
  /** v2-6 dependency installer: lockfile libraries and host system programs, into a staging module directory. */
  packages?: {
    install(input: { dir: string; packages: string[] }): Promise<{ errors: string[]; installed: { npm: boolean; python: boolean; packages: Record<string, string[]> } }>;
  };
  /** The `chrona` SDK package directory (sdk.ts, testing.ts) given to module builds. */
  moduleSdk?: string;
  /** Trusted host-resolved native process guardian, never supplied by module material. */
  processHelper?: string;
  /** Explicit host-configured release input directory; never a request-provided host path. */
  moduleExternalResources?: string;
  /** B's bounded adapter to the existing proposal/build/activation queue. Must not run checks inline. */
  moduleExternalInstaller?: ExternalModuleInstaller;
  onQueued?: () => Promise<unknown>;
  onRunFinished?: (workspaceId: string, runId: string) => Promise<void>;
  onApproved?: OnApproved;
  sandbox?: {
    /** Set by the host, never inferred from missing isolation or supplied by a module. */
    executionMode?: "trusted-local";
    /** Host runtime is configured; entry-specific interpreter availability is checked at launch. */
    available: boolean;
    /** Legacy health projection; trusted local execution uses OS permissions. */
    isolated: boolean;
    startModule?(input: { codeDir: string; dataDir: string; contentDir?: string; env?: Record<string, string>; entry: ModuleEntry; ipcEndpoint: string; ipcToken: string; network?: boolean }): { pid: number; exited: Promise<{ code: number | null; signal: string | null }>; stderr(): string; kill(): void };
    runModule?(input: { codeDir: string; dataDir: string; contentDir?: string; entry: string; input: unknown; network?: boolean; timeoutMs?: number; maxOutputBytes?: number }): Promise<{ status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null; exitCode?: number }>;
  };

};

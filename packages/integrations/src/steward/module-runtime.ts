import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@chrona/db";
import { sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { createExternalModuleInstaller, type StewardPorts } from "@chrona/engine";
import { readProtectedSecret } from "./protected-secret";
import { createScriptSandbox } from "./script-sandbox";
import { createModulePackages } from "./module-packages";
import runtimeDeclarations from "./runtimes.json";

function publicOrigin(): string | null {
  try {
    const url = new URL(process.env.CHRONA_PUBLIC_URL ?? "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}
export function stewardDataDir(env = process.env): string {
  if (env.CHRONA_DATA_DIR?.trim()) return resolve(env.CHRONA_DATA_DIR.trim());
  const file = sqlitePathFromFileUrl(env.DATABASE_URL ?? "file:./prisma/dev.db");
  if (!file || file === ":memory:") throw new Error("CHRONA_DATA_DIR required for an in-memory database");
  return dirname(resolve(file));
}
/** Packaged releases never fall back to a developer source tree for absent resources. */
export function resourcePath(relative: string, source = relative): string {
  const root = process.env.CHRONA_RESOURCE_DIR || (existsSync(join(dirname(process.execPath), "resources")) ? join(dirname(process.execPath), "resources") : null);
  return root ? join(root, relative) : fileURLToPath(new URL(`../../../../${source}`, import.meta.url));
}
export function executionMode(env = process.env): "trusted-local" {
  if (env.CHRONA_STEWARD_SANDBOX_BWRAP?.trim()) throw new Error("CHRONA_STEWARD_SANDBOX_BWRAP has been removed; remove the setting to use trusted-local execution");
  const configured = env.CHRONA_STEWARD_EXECUTION_MODE?.trim();
  if (!configured || configured === "trusted-local") return "trusted-local";
  throw new Error("CHRONA_STEWARD_EXECUTION_MODE supports only trusted-local; required-isolation has been removed");
}
async function configuredSecret(name: string) {
  const appId = process.env.CHRONA_QQ_APP_ID?.trim(), file = process.env.CHRONA_QQ_SECRET_FILE?.trim();
  return name === "qq_bot" && appId && file ? { appId, clientSecret: await readProtectedSecret(file) } : null;
}
export function processHelperPath(): string {
  const executable = `chrona-process-guardian${process.platform === "win32" ? ".exe" : ""}`;
  return process.env.CHRONA_PROCESS_HELPER ?? resourcePath(`process/${process.platform}-${process.arch}/${executable}`, `packages/process/bin/${process.platform}-${process.arch}/${executable}`);
}
/** Shared offline install/build resources; construction never starts a Provider, tick, or module. */
export function createModuleRuntimePorts(db: PrismaClient, options: { dataDir?: string; now?: () => Date; sandbox?: StewardPorts["sandbox"] } = {}): StewardPorts {
  const moduleSdk = resourcePath("module-sdk", "packages/integrations/src/steward/module-sdk");
  const moduleTypecheck = resourcePath("module-typecheck", "packages/integrations/src/steward/module-typecheck");
  const processHelper = processHelperPath();
  const scriptSandbox = createScriptSandbox({ executionMode: executionMode(), dataDir: resolve(options.dataDir ?? stewardDataDir()), moduleSdk, moduleTypecheck, processHelper });
  const ports: StewardPorts = {
    db, now: options.now ?? (() => new Date()), dataDir: options.dataDir ?? stewardDataDir(), publicUrl: publicOrigin(),
    secrets: configuredSecret, secretConfigured: async name => name === "qq_bot" && !!process.env.CHRONA_QQ_APP_ID?.trim() && !!process.env.CHRONA_QQ_SECRET_FILE?.trim() && existsSync(process.env.CHRONA_QQ_SECRET_FILE.trim()),
    packages: createModulePackages({ processHelper }), moduleSdk,
    moduleTypecheck, processHelper, moduleRuntimes: runtimeDeclarations,
    moduleExternalResources: resourcePath("external", "packages/engine/src/modules/steward/applications"),
    sandbox: options.sandbox ?? { ...scriptSandbox.health, executionMode: executionMode(), runModule: input => scriptSandbox.runModule(input), startModule: input => scriptSandbox.startModule(input) },
  };
  ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
  return ports;
}

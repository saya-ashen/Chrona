import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@chrona/db";
import { resolveRuntimeDatabaseUrl, sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { createExternalModuleInstaller, type StewardPorts } from "@chrona/kernel";
import { createScriptSandbox } from "./script-sandbox";
import { createModulePackages } from "../packages/module-packages";

function publicOrigin(): string | null {
  if (!process.env.CHRONA_PUBLIC_URL) return null;
  try {
    const url = new URL(process.env.CHRONA_PUBLIC_URL);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch (error) {
    console.error(JSON.stringify({ component: "module-runtime", event: "operation.failed", error: String(error) }));
 return null; }
}
export function stewardDataDir(env = process.env): string {
  if (env.CHRONA_DATA_DIR?.trim()) return resolve(env.CHRONA_DATA_DIR.trim());
  const file = sqlitePathFromFileUrl(resolveRuntimeDatabaseUrl(env));
  if (!file || file === ":memory:") throw new Error("CHRONA_DATA_DIR required for an in-memory database");
  return dirname(resolve(file));
}
/** Packaged releases never fall back to a developer source tree for absent resources. */
export function resourcePath(relative: string, source = relative): string {
  const root = process.env.CHRONA_RESOURCE_DIR || (existsSync(join(dirname(process.execPath),
    "resources")) ? join(dirname(process.execPath), "resources") : null);
  return root ? join(root, relative) : fileURLToPath(new URL(`../../../../${source}`, import.meta.url));
}
export function executionMode(env = process.env): "trusted-local" {
  if (env.CHRONA_STEWARD_SANDBOX_BWRAP?.trim()) throw new Error("CHRONA_STEWARD_SANDBOX_BWRAP has been removed; remove the setting to use trusted-local execution");
  const configured = env.CHRONA_STEWARD_EXECUTION_MODE?.trim();
  if (!configured || configured === "trusted-local") return "trusted-local";
  throw new Error("CHRONA_STEWARD_EXECUTION_MODE supports only trusted-local; required-isolation has been removed");
}
export function processHelperPath(): string {
  const executable = `chrona-process-guardian${process.platform === "win32" ? ".exe" : ""}`;
  return process.env.CHRONA_PROCESS_HELPER ?? resourcePath(`process/${process.platform}-${process.arch}/${executable}`,
    `packages/process/bin/${process.platform}-${process.arch}/${executable}`);
}
/** Shared offline install/build resources; construction never starts a Provider, tick, or module. */
export function createModuleRuntimePorts(db: PrismaClient, options: { dataDir?: string; now?: () => Date;
  sandbox?: StewardPorts["sandbox"] } = {}): StewardPorts {
  const moduleSdk = resourcePath("module-sdk", "packages/app-sdk");
  const processHelper = processHelperPath();
  const scriptSandbox = createScriptSandbox({ executionMode: executionMode(), dataDir: resolve(options.dataDir ?? stewardDataDir()),
    moduleSdk, processHelper });
  const ports: StewardPorts = {
    db, now: options.now ?? (() => new Date()), dataDir: options.dataDir ?? stewardDataDir(), publicUrl: publicOrigin(),
    packages: createModulePackages({ processHelper }), moduleSdk,
    processHelper,
    moduleExternalResources: process.env.CHRONA_MODULE_RESOURCES ? resolve(process.env.CHRONA_MODULE_RESOURCES) : undefined,
    sandbox: options.sandbox ?? { ...scriptSandbox.health, executionMode: executionMode(),
      runModule: input => scriptSandbox.runModule(input), startModule: input => scriptSandbox.startModule(input) },
  };
  ports.moduleExternalInstaller = createExternalModuleInstaller(ports);
  return ports;
}

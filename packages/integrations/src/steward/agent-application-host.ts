import { resolve } from "node:path";
import { createScriptSandbox } from "./script-sandbox";
import { resourcePath, executionMode, stewardDataDir, processHelperPath } from "./module-runtime";
import { PI_MODEL_ENVIRONMENT_KEYS } from "@chrona/pi";
import { piHostConfiguration, type PiHostOptions } from "./pi-model-gateway";

/** Pi-owned host configuration, granted only to the exact trusted Pi release by the supervisor. */
export function createPiApplicationHost(options: PiHostOptions) {
  const dataDir = resolve(options.dataDir ?? stewardDataDir()), mode = executionMode(), processHelper = processHelperPath();
  const host = createScriptSandbox({ executionMode: mode, dataDir, moduleSdk: resourcePath("module-sdk", "packages/integrations/src/steward/module-sdk"), moduleTypecheck: resourcePath("module-typecheck", "packages/integrations/src/steward/module-typecheck"), processHelper });
  const configuration = piHostConfiguration({ ...options, dataDir });
  return {
    env: { CHRONA_PROCESS_HELPER: processHelper, CHRONA_PROVIDER_CONFIGURATION: JSON.stringify(configuration), CHRONA_PROVIDER_MODEL_ENV: JSON.stringify(Object.fromEntries(PI_MODEL_ENVIRONMENT_KEYS.flatMap(key => process.env[key] ? [[key, process.env[key]]] : []))), ...(process.env.CHRONA_STEWARD_BROWSER?.trim() ? { CHRONA_STEWARD_BROWSER: process.env.CHRONA_STEWARD_BROWSER.trim() } : {}) },
    startModule: host.startModule,
  };
}

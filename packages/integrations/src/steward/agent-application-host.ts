import { resolve } from "node:path";
import { createScriptSandbox } from "./script-sandbox";
import { resourcePath, executionMode, stewardDataDir, processHelperPath } from "./module-runtime";
import { PI_MODEL_ENVIRONMENT_KEYS } from "@chrona/pi";
import { piHostConfiguration, type PiHostOptions } from "./pi-model-gateway";

/** Only the immutable Agent receives this host binding; application manifests cannot request it. */
export function createAgentApplicationHost(options: PiHostOptions) {
  const dataDir = resolve(options.dataDir ?? stewardDataDir()), mode = executionMode(), processHelper = processHelperPath();
  const host = createScriptSandbox({ executionMode: mode, dataDir, moduleSdk: resourcePath("module-sdk", "packages/integrations/src/steward/module-sdk"), moduleTypecheck: resourcePath("module-typecheck", "packages/integrations/src/steward/module-typecheck"), processHelper });
  const configuration = {
    backend: process.env.CHRONA_STEWARD_AGENT ?? "unconfigured",
    pi: piHostConfiguration({ ...options, dataDir }),
    browser: { configured: process.env.CHRONA_STEWARD_BROWSER?.trim() || undefined },
  };
  return {
    env: { CHRONA_PROCESS_HELPER: processHelper, CHRONA_AGENT_CONFIGURATION: JSON.stringify(configuration), CHRONA_AGENT_MODEL_ENV: JSON.stringify(Object.fromEntries(PI_MODEL_ENVIRONMENT_KEYS.flatMap(key => process.env[key] ? [[key, process.env[key]]] : []))) },
    startModule: host.startModule,
  };
}

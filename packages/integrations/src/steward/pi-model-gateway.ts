import { resolve } from "node:path";
import type { PiProviderOptions } from "@chrona/pi";
import { executionMode, resourcePath, stewardDataDir, processHelperPath } from "./runtime/module-runtime";

export type PiHostOptions = { port: number; dataDir?: string };

/** Pi module launch bindings; execution and completion both use its registered endpoints. */
export function piHostConfiguration(options: PiHostOptions): PiProviderOptions {
  const dataDir = resolve(options.dataDir ?? stewardDataDir());
  return {
    agentUrl: `http://127.0.0.1:${options.port}/api/steward-agent`,
    chronaExtension: resourcePath("pi/chrona-tools.ts", "packages/pi/resources/chrona-tools.ts"),
    command: process.env.CHRONA_STEWARD_PI_COMMAND, model: process.env.CHRONA_STEWARD_PI_MODEL,
    agentDir: process.env.CHRONA_STEWARD_PI_AGENT_DIR,
    expectedVersion: process.env.CHRONA_STEWARD_PI_VERSION,
    resourcesFile: process.env.CHRONA_STEWARD_PI_RESOURCES_FILE,
    webExtension: process.env.CHRONA_STEWARD_PI_WEB_EXTENSION,
    executionMode: executionMode(), processHelper: processHelperPath(),
    browserExtension: resourcePath("pi/browser-tools.ts", "packages/pi/resources/browser-tools.ts"),
    workspaceRoot: resolve(dataDir, "sessions"),
  };
}

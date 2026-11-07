import { resolve, join } from "node:path";
import { createScriptSandbox } from "./script-sandbox";
import { resourcePath, executionMode, stewardDataDir } from "./module-runtime";
import { PI_MODEL_ENVIRONMENT_KEYS } from "./pi-launch";

/** Only the immutable Agent receives this host binding; application manifests cannot request it. */
export function createAgentApplicationHost(options: { port: number; dataDir?: string }) {
  const dataDir = resolve(options.dataDir ?? stewardDataDir()), mode = executionMode();
  const host = createScriptSandbox({ executionMode: "trusted-local", dataDir, moduleSdk: resourcePath("module-sdk", "packages/integrations/src/steward/module-sdk") });
  const configuration = {
    backend: process.env.CHRONA_STEWARD_AGENT ?? "unconfigured",
    pi: {
      agentUrl: `http://127.0.0.1:${options.port}/api/steward-agent`,
      chronaExtension: resourcePath(join("external-plugins", "pi-steward-agent", "chrona-tools.ts")),
      command: process.env.CHRONA_STEWARD_PI_COMMAND, model: process.env.CHRONA_STEWARD_PI_MODEL,
      agentDir: process.env.CHRONA_STEWARD_PI_AGENT_DIR ?? resolve(dataDir, "providers/pi"),
      expectedVersion: process.env.CHRONA_STEWARD_PI_VERSION,
      resourcesFile: process.env.CHRONA_STEWARD_PI_RESOURCES_FILE,
      webExtension: process.env.CHRONA_STEWARD_PI_WEB_EXTENSION,
      bwrap: process.env.CHRONA_STEWARD_SANDBOX_BWRAP, executionMode: mode,
      browserExtension: resourcePath(join("external-plugins", "pi-steward-agent", "browser-tools.ts")),
      workspaceRoot: resolve(dataDir, "sessions"), dataDir,
    },
    browser: { configured: process.env.CHRONA_STEWARD_BROWSER?.trim() || undefined, dir: resolve(dataDir, "providers/browser"), nix: Bun.which("nix"), nixpkgs: process.env.CHRONA_NIXPKGS?.trim() || undefined },
  };
  return {
    env: { CHRONA_AGENT_CONFIGURATION: JSON.stringify(configuration), CHRONA_AGENT_MODEL_ENV: JSON.stringify(Object.fromEntries(PI_MODEL_ENVIRONMENT_KEYS.flatMap(key => process.env[key] ? [[key, process.env[key]]] : []))) },
    startModule: host.startModule,
  };
}

import { randomBytes } from "node:crypto";

import { installHermesPlugin } from "./plugin.js";
import { detectHermesEnvironment } from "./detect.js";
import { writeHermesEnvValues } from "./env-file.js";
import { planHermesSetup } from "./plan.js";
import type { HermesDiagnostics, HermesLocalSetupInput, HermesSetupPlan } from "./types.js";

export type HermesLocalSetupResult = {
  diagnostics: HermesDiagnostics;
  plan: HermesSetupPlan;
  apiKey: string;
  changed: string[];
  restartRequired: boolean;
};

export function generateHermesApiKey(): string {
  return `chrona-${randomBytes(24).toString("base64url")}`;
}

export function maskHermesApiKey(apiKey: string): string {
  if (apiKey.length <= 10) return "********";
  return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
}

export async function setupLocalHermesIntegration(input: HermesLocalSetupInput): Promise<HermesLocalSetupResult> {
  const before = await detectHermesEnvironment(input);
  if (before.mode !== "local") {
    throw new Error("Local Hermes setup is only available for localhost or 127.0.0.1 base URLs.");
  }

  const plan = planHermesSetup(before);
  const changed: string[] = [];
  let restartRequired = false;

  const shouldInstallPlugin = plan.actions.some((action) => action.key === "installPlugin" || action.key === "updatePlugin");
  const shouldUpdatePluginConfig = plan.actions.some((action) => action.key === "updatePluginConfig");

  if (shouldInstallPlugin || shouldUpdatePluginConfig) {
    const result = await installHermesPlugin({
      hermesHome: input.hermesHome,
      mcpUrl: input.mcpUrl,
      pluginDir: input.pluginDir,
      skipEnable: input.skipEnable,
    });
    changed.push(`plugin:${result.installDir}`);
    if (result.enabled) changed.push("plugin-enabled");
    restartRequired = shouldInstallPlugin;
  }

  if (plan.actions.some((action) => action.key === "writeApiEnv")) {
    const result = writeHermesEnvValues({
      API_SERVER_ENABLED: "true",
      API_SERVER_KEY: input.apiKey,
    }, input.hermesHome);
    if (result.changed) changed.push(`env:${result.envPath}`);
    restartRequired = restartRequired || result.changed;
  }

  const diagnostics = await detectHermesEnvironment(input);
  return {
    diagnostics: { ...diagnostics, restartRequired },
    plan: planHermesSetup(diagnostics),
    apiKey: input.apiKey,
    changed,
    restartRequired,
  };
}

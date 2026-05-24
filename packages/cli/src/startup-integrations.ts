import {
  getBundledHermesPluginVersion,
  getHermesPluginDir,
  getInstalledHermesPluginVersion,
  installHermesPlugin,
  isHermesCliAvailable,
  isHermesPluginInstalled,
  readHermesPluginConfig,
  writeHermesPluginConfig,
} from "./hermes-plugin.js";

type StartupIntegrationContext = {
  mcpUrl: string;
};

type StartupIntegrationCheck = {
  name: string;
  run: (context: StartupIntegrationContext) => Promise<void>;
};

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function askYesNo(message: string): boolean {
  if (!isInteractive()) return false;
  const answer = prompt(`${message} [y/N]`);
  return answer?.trim().toLowerCase() === "y";
}

const hermesIntegration: StartupIntegrationCheck = {
  name: "Hermes",
  async run({ mcpUrl }) {
    const pluginDir = getHermesPluginDir();

    console.log("Hermes:");

    if (!isHermesCliAvailable()) {
      console.log("  Hermes CLI not found locally.");
      console.log("  For remote Hermes, configure this MCP URL manually:");
      console.log(`  CHRONA_MCP_URL=${mcpUrl}`);
      console.log("");
      return;
    }

    if (!isHermesPluginInstalled(pluginDir)) {
      console.log("  Chrona plugin is not installed locally.");

      if (askYesNo("Install and configure the Chrona Hermes plugin now?")) {
        const result = await installHermesPlugin({ mcpUrl });
        console.log(`  Installed to ${result.installDir}`);
        console.log(`  Configured MCP URL: ${result.mcpUrl}`);
        console.log(result.enabled ? "  Enabled plugin." : "  Plugin copied; enable later with: hermes plugins enable chrona");
      } else {
        console.log(`  Install later with: chrona hermes plugin install --mcp-url ${mcpUrl}`);
      }

      console.log("");
      return;
    }

    const config = readHermesPluginConfig(pluginDir);
    const installedVersion = getInstalledHermesPluginVersion(pluginDir);
    const bundledVersion = getBundledHermesPluginVersion();

    if (installedVersion !== bundledVersion) {
      console.log(`  Chrona plugin version is ${installedVersion ?? "unknown"}.`);
      console.log(`  Bundled Chrona plugin version is ${bundledVersion}.`);

      if (askYesNo("Update the local Chrona Hermes plugin now?")) {
        const result = await installHermesPlugin({ mcpUrl });
        console.log(`  Updated ${result.installDir}`);
        console.log(`  Configured MCP URL: ${result.mcpUrl}`);
        console.log(`  Installed plugin version: ${result.pluginVersion}`);
      } else {
        console.log(`  Update later with: chrona hermes plugin install --mcp-url ${mcpUrl}`);
      }
    } else if (config?.mcpUrl !== mcpUrl) {
      console.log(`  Chrona plugin MCP URL is ${config?.mcpUrl ?? "not configured"}.`);
      console.log(`  Current Chrona MCP URL is ${mcpUrl}.`);

      if (askYesNo("Update the local Chrona Hermes plugin configuration now?")) {
        writeHermesPluginConfig(pluginDir, { ...config, mcpUrl, pluginVersion: bundledVersion });
        console.log(`  Updated ${pluginDir}`);
      } else {
        console.log(`  Update later with: chrona hermes plugin install --mcp-url ${mcpUrl}`);
      }
    } else {
      console.log(`  Chrona plugin configured: ${mcpUrl}`);
      console.log(`  Chrona plugin version: ${installedVersion}`);
    }

    console.log("");
  },
};

const startupIntegrationChecks: StartupIntegrationCheck[] = [
  hermesIntegration,
];

export async function runStartupIntegrationChecks(context: StartupIntegrationContext): Promise<void> {
  for (const check of startupIntegrationChecks) {
    try {
      await check.run(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${check.name}: skipped startup check (${message})`);
      console.log("");
    }
  }
}

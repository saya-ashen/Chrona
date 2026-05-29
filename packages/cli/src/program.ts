import { Command } from "commander";
import { installHermesPlugin, type InstallHermesPluginOptions } from "./hermes-plugin.js";
import {
  detectHermesEnvironment,
  generateHermesApiKey,
  getHermesEnvApiKey,
  maskHermesApiKey,
  planHermesSetup,
  setupLocalHermesIntegration,
  type HermesDiagnostics,
  type HermesSetupPlan,
} from "./integrations/hermes/index.js";

type HermesCommandOptions = {
  apiKey?: string;
  baseUrl?: string;
  hermesHome?: string;
  mcpUrl?: string;
  pluginDir?: string;
  skipEnable?: boolean;
  showApiKey?: boolean;
};

function printHermesDiagnostics(diagnostics: HermesDiagnostics, plan: HermesSetupPlan): void {
  console.log(`Hermes mode: ${diagnostics.mode}`);
  console.log(`Hermes base URL: ${diagnostics.baseUrl}`);
  console.log(`Chrona MCP URL: ${diagnostics.mcpUrl}`);
  console.log("");

  console.log("Checks:");
  for (const check of diagnostics.checks) {
    console.log(`  [${check.status}] ${check.key}: ${check.message}`);
  }
  console.log("");

  console.log(`Plan: ${plan.summary}`);
  for (const action of plan.actions) {
    const blocked = action.blocked ? " blocked" : "";
    console.log(`  [${action.kind}${blocked}] ${action.key}: ${action.reason}`);
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("chrona")
    .description("Chrona CLI: starts the Chrona app server.")
    .version("0.2.0");

  const hermes = program
    .command("hermes")
    .description("Hermes integration commands");

  const hermesPlugin = hermes
    .command("plugin")
    .description("Hermes plugin commands");

  hermes
    .command("doctor")
    .description("Diagnose Hermes integration state without changing files")
    .option("--base-url <url>", "Hermes API base URL", "http://127.0.0.1:8642")
    .option("--api-key <key>", "Hermes API key")
    .option("--mcp-url <url>", "Chrona MCP endpoint for the plugin")
    .option("--hermes-home <path>", "Hermes home directory")
    .option("--plugin-dir <path>", "Hermes plugin install directory")
    .action(async (options: HermesCommandOptions) => {
      const diagnostics = await detectHermesEnvironment(options);
      const plan = planHermesSetup(diagnostics);
      printHermesDiagnostics(diagnostics, plan);
    });

  hermes
    .command("setup")
    .description("Auto-configure local Hermes plugin and API server env")
    .option("--base-url <url>", "Hermes API base URL", "http://127.0.0.1:8642")
    .option("--api-key <key>", "Hermes API key; generated when omitted")
    .option("--mcp-url <url>", "Chrona MCP endpoint for the plugin")
    .option("--hermes-home <path>", "Hermes home directory")
    .option("--plugin-dir <path>", "Hermes plugin install directory")
    .option("--skip-enable", "Copy the plugin without enabling it", false)
    .option("--show-api-key", "Print the full Hermes API key", false)
    .action(async (options: HermesCommandOptions) => {
      const apiKey = options.apiKey ?? getHermesEnvApiKey(options.hermesHome) ?? generateHermesApiKey();
      const result = await setupLocalHermesIntegration({ ...options, apiKey });

      console.log(`Hermes API key: ${options.showApiKey ? apiKey : maskHermesApiKey(apiKey)}`);
      if (!options.showApiKey) {
        console.log("Use --show-api-key to print the full key, or read API_SERVER_KEY from ~/.hermes/.env.");
      }
      if (result.changed.length > 0) {
        console.log("Changed:");
        for (const item of result.changed) console.log(`  ${item}`);
      } else {
        console.log("Changed: none");
      }
      console.log("");

      printHermesDiagnostics(result.diagnostics, result.plan);
      if (result.diagnostics.restartRequired) {
        console.log("");
        console.log("Restart Hermes, then rerun: chrona hermes doctor");
      }
    });

  hermesPlugin
    .command("install")
    .description("Install the Chrona Hermes plugin")
    .option("--hermes-home <path>", "Hermes home directory")
    .option("--mcp-url <url>", "Chrona MCP endpoint for the plugin")
    .option("--plugin-dir <path>", "Hermes plugin install directory")
    .option("--skip-enable", "Copy the plugin without enabling it", false)
    .action(async (options: InstallHermesPluginOptions) => {
      const result = await installHermesPlugin(options);
      console.log(`Chrona Hermes plugin installed to ${result.installDir}`);
      console.log(`Chrona MCP URL configured as ${result.mcpUrl}`);
      console.log(`Chrona Hermes plugin version ${result.pluginVersion}`);

      if (options.skipEnable || process.env.CHRONA_HERMES_SKIP_ENABLE === "1") {
        console.log("Skipped Hermes enable step. Enable later with: hermes plugins enable chrona");
      } else if (result.enabled) {
        console.log("Chrona Hermes plugin enabled.");
      } else {
        console.log("Chrona Hermes plugin copied, but Hermes CLI was unavailable or enable failed.");
        console.log("Enable later with: hermes plugins enable chrona");
      }
    });

  return program;
}

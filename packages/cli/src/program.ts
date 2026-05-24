import { Command } from "commander";
import { installHermesPlugin, type InstallHermesPluginOptions } from "./hermes-plugin.js";

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

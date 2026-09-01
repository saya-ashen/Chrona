import { Command } from "commander";
import { buildControlPayload, sendControlAction, UsageError, ConfigError } from "@chrona-org/agent-cli";
import { join, resolve } from "node:path";
import { backupSqliteDatabase, restoreSqliteDatabase } from "@chrona/db/sqlite-backup";
import cliPackage from "../package.json" with { type: "json" };
import { getChronaDataDir } from "./start-server.js";
import { inspectLocalChrona, repairStaleRuntimeLock } from "./doctor.js";
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

export type NodeDispatchResult = {
  code: 0 | 1;
  stdout: string;
  stderr: string;
};

/**
 * Dispatch `chrona node <verb>` (and `chrona task read` / `chrona plan read`)
 * directly to the agent-cli library without going through Commander. The
 * reason: the verb is a free-form positional that doesn't fit Commander's
 * strict subcommand schema, and we want zero surprising option parsing.
 */
export async function dispatchNodeCommand(argv: readonly string[]): Promise<NodeDispatchResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  try {
    const { body } = buildControlPayload([...argv]);
    const result = await sendControlAction(body, {
      env: {
        CHRONA_BASE_URL: process.env.CHRONA_BASE_URL,
        CHRONA_RUN_TOKEN: process.env.CHRONA_RUN_TOKEN,
      },
      fetchImpl: fetch,
    });
    stdoutChunks.push(`${JSON.stringify(result)}\n`);
    return { code: 0, stdout: stdoutChunks.join(""), stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UsageError) {
      stderrChunks.push(`Usage error: ${message}\n`);
      stderrChunks.push("Usage: chrona node complete --summary <text> [--result-file <path>] | chrona node <condition-select|wait-complete|block|fail> [...]\n");
    } else if (error instanceof ConfigError) {
      stderrChunks.push(`Config error: ${message}\n`);
      stderrChunks.push("Chrona skill-mode commands require CHRONA_BASE_URL and CHRONA_RUN_TOKEN in env.\n");
    } else {
      stderrChunks.push(`Chrona agent command failed: ${message}\n`);
    }
    return { code: 1, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
  }
}

type HermesCommandOptions = {
  apiKey?: string;
  baseUrl?: string;
  hermesHome?: string;
  mcpUrl?: string;
  pluginDir?: string;
  skipEnable?: boolean;
  showApiKey?: boolean;
};

export type StartCommandOptions = {
  host?: string;
  port?: string;
  open?: boolean;
};

type CreateProgramOptions = {
  startServer?: (options: StartCommandOptions) => Promise<void>;
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

export function createProgram(options: CreateProgramOptions = {}): Command {
  const program = new Command();

  program
    .name("chrona")
    .description("Chrona CLI: starts the Chrona app server.")
    .version(cliPackage.version);

  program
    .command("start")
    .description("Start the Chrona app server")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--port <port>", "Port to bind", "3101")
    .option("--no-open", "Do not open Chrona in the default browser")
    .action(async (startOptions: StartCommandOptions) => {
      if (!options.startServer) {
        throw new Error("chrona start is only available in packaged Chrona binaries.");
      }
      await options.startServer(startOptions);
    });

  program
    .command("backup")
    .description("Create a consistent backup of the Chrona SQLite database")
    .argument("<output>", "Backup database path")
    .action((output: string) => {
      const databaseUrl = process.env.DATABASE_URL ?? `file:${join(getChronaDataDir(), "chrona.db")}`;
      const result = backupSqliteDatabase(databaseUrl, resolve(output));
      console.log(`Chrona backup created: ${result.backupPath}`);
    });

  program
    .command("restore")
    .description("Restore a Chrona SQLite database backup while the server is stopped")
    .argument("<input>", "Backup database path")
    .option("--force", "Replace the current Chrona database", false)
    .action((input: string, restoreOptions: { force?: boolean }) => {
      const databaseUrl = process.env.DATABASE_URL ?? `file:${join(getChronaDataDir(), "chrona.db")}`;
      const result = restoreSqliteDatabase(databaseUrl, resolve(input), {
        force: restoreOptions.force,
      });
      console.log(`Chrona database restored: ${result.backupPath}`);
    });

  program
    .command("doctor")
    .description("Inspect local database and network safety before starting Chrona")
    .option("--repair-stale-lock", "Quarantine a confirmed stale runtime lock; never removes the database")
    .action((doctorOptions: { repairStaleLock?: boolean }) => {
      if (doctorOptions.repairStaleLock) {
        const quarantined = repairStaleRuntimeLock();
        console.log(quarantined ? `Stale runtime lock quarantined: ${quarantined}` : "No runtime lock is present.");
      }
      const checks = inspectLocalChrona();
      for (const check of checks) {
        console.log(`[${check.status}] ${check.key}: ${check.message}`);
      }
      if (checks.some((check) => check.status === "error")) {
        process.exitCode = 1;
      }
    });

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
    .option("--plugin-dir <path>", "Chrona plugin install directory")
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
    .option("--plugin-dir <path>", "Chrona plugin install directory")
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
    .option("--plugin-dir <path>", "Chrona plugin install directory")
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

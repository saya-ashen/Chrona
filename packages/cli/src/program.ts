import { Command } from "commander";
import { join, resolve } from "node:path";
import { backupSqliteDatabase, restoreSqliteDatabase } from "@chrona/db/sqlite-backup";
import cliPackage from "../package.json" with { type: "json" };
import { getChronaDataDir } from "./start-server.js";
import { inspectLocalChrona, repairStaleRuntimeLock } from "./doctor.js";

export type StartCommandOptions = { host?: string; port?: string; open?: boolean };
type CreateProgramOptions = { startServer?: (options: StartCommandOptions) => Promise<void> };

export function createProgram(options: CreateProgramOptions = {}): Command {
  const program = new Command().name("chrona").description("Chrona personal steward").version(cliPackage.version);
  program.command("start").description("Start the Chrona app server")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--port <port>", "Port to bind", "3101")
    .option("--no-open", "Do not open Chrona in the default browser")
    .action(async (input: StartCommandOptions) => {
      if (!options.startServer) throw new Error("chrona start is only available in packaged Chrona binaries.");
      await options.startServer(input);
    });
  program.command("backup").description("Create a consistent SQLite backup")
    .argument("<output>", "Backup database path")
    .action((output: string) => {
      const databaseUrl = process.env.DATABASE_URL ?? `file:${join(getChronaDataDir(), "chrona.db")}`;
      const result = backupSqliteDatabase(databaseUrl, resolve(output));
      console.log(`Chrona backup created: ${result.backupPath}`);
    });
  program.command("restore").description("Restore a SQLite backup while the server is stopped")
    .argument("<input>", "Backup database path")
    .option("--force", "Replace the current Chrona database", false)
    .action((input: string, restoreOptions: { force?: boolean }) => {
      const databaseUrl = process.env.DATABASE_URL ?? `file:${join(getChronaDataDir(), "chrona.db")}`;
      const result = restoreSqliteDatabase(databaseUrl, resolve(input), { force: restoreOptions.force });
      console.log(`Chrona database restored: ${result.backupPath}`);
    });
  program.command("doctor").description("Inspect local database and network safety")
    .option("--repair-stale-lock", "Quarantine a confirmed stale runtime lock; never removes the database")
    .action((input: { repairStaleLock?: boolean }) => {
      if (input.repairStaleLock) {
        const quarantined = repairStaleRuntimeLock();
        console.log(quarantined ? `Stale runtime lock quarantined: ${quarantined}` : "No runtime lock is present.");
      }
      const checks = inspectLocalChrona();
      for (const check of checks) console.log(`[${check.status}] ${check.key}: ${check.message}`);
      if (checks.some((check) => check.status === "error")) process.exitCode = 1;
    });
  const qq = program.command("qq").description("Chrona QQ bot local administration");
  qq.command("bind-code").description("Create a one-time owner binding code (only its hash is stored)")
    .requiredOption("--workspace <id>", "Workspace the bound QQ owner acts in")
    .option("--ttl <minutes>", "Validity in minutes (1-60)", "10")
    .option("--replace", "Allow replacing an existing owner binding")
    .action(async (input: { workspace: string; ttl: string; replace?: boolean }) => {
      const { createQqBotState, qqBotConfig } = await import("@chrona/integrations/steward");
      const config = qqBotConfig();
      if (!config) throw new Error("CHRONA_QQ_APP_ID and CHRONA_QQ_STATE_DIR (or CHRONA_DATA_DIR) are required");
      const challenge = await createQqBotState(config.stateDir, config.appId).createChallenge({ workspaceId: input.workspace, ttlMinutes: Number(input.ttl), replace: Boolean(input.replace) });
      console.log(JSON.stringify({ appId: config.appId, ...challenge }));
    });
  return program;
}

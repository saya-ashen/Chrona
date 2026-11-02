import { Command } from "commander";
import { join, resolve } from "node:path";
import { backupSqliteDatabase, restoreSqliteDatabase } from "@chrona/db/sqlite-backup";
import cliPackage from "../package.json" with { type: "json" };
import { getChronaDataDir } from "./start-server.js";
import { inspectLocalChrona, repairStaleRuntimeLock } from "./doctor.js";
import { removeSecret, runAdmin, setSecret } from "./admin";

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
  program.command("backup").description("Back up SQLite, platform, sessions and secrets while the server is stopped")
    .argument("<output>", "Backup database path")
    .action((output: string) => {
      const databaseUrl = process.env.DATABASE_URL ?? `file:${join(getChronaDataDir(), "chrona.db")}`;
      const result = backupSqliteDatabase(databaseUrl, resolve(output), getChronaDataDir());
      console.log(`Chrona backup created: ${result.backupPath} + ${result.backupPath}.tar`);
    });
  program.command("restore").description("Restore SQLite and its platform, sessions and secrets tar while the server is stopped")
    .argument("<input>", "Backup database path")
    .option("--force", "Replace the current Chrona database", false)
    .action((input: string, restoreOptions: { force?: boolean }) => {
      const databaseUrl = process.env.DATABASE_URL ?? `file:${join(getChronaDataDir(), "chrona.db")}`;
      const result = restoreSqliteDatabase(databaseUrl, resolve(input), { force: restoreOptions.force, dataDir: getChronaDataDir() });
      console.log(`Chrona backup restored: ${result.backupPath}`);
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
  const admin = program.command("admin").description("Local recovery administration (only build invokes the Provider)");
  admin.command("build <request-file>").description("Run one explicitly authorized bounded module build while the service is stopped; never activates it")
    .action(async (file: string) => { const { adminBuild } = await import("./admin-build"); await adminBuild(file); });
  admin.command("modules").description("List modules and versions").action(async () => { await runAdmin("modules"); });
  admin.command("diagnostics [module]").description("Read saved module faults and recovery attempts without starting Chrona").action(async (module?: string) => { await runAdmin("diagnostics", module ? [module] : []); });
  admin.command("approvals").description("List pending approvals, including rescue-only items").action(async () => { await runAdmin("approvals"); });
  admin.command("rollback <module> <hash-or-builtin>").description("Roll back an approved module version").action(async (module: string, hash: string) => { await runAdmin("rollback", [module, hash]); });
  admin.command("disable <module>").description("Pause a module").action(async (module: string) => { await runAdmin("disable", [module]); });
  for (const command of ["approve", "reject"] as const) admin.command(`${command} <approvalId>`).description(`${command} a pending approval`).action(async (id: string) => { await runAdmin(command, [id]); });
  admin.command("secret-set <name>").description("Save a module credential from a JSON object on stdin (never echoed)").action(async (name: string) => { await setSecret(name, await Bun.stdin.text()); });
  admin.command("secret-remove <name>").description("Delete a saved module credential").action(async (name: string) => { await removeSecret(name); });
  const qq = program.command("qq").description("Chrona QQ bot local administration");
  qq.command("bind-code").description("Create a one-time owner binding code (only its hash is stored)")
    .requiredOption("--workspace <id>", "Workspace the bound QQ owner acts in")
    .option("--ttl <minutes>", "Validity in minutes (1-60)", "10")
    .option("--replace", "Allow replacing an existing owner binding")
    .action(async (input: { workspace: string; ttl: string; replace?: boolean }) => {
      const { qqBindCode } = await import("./admin");
      console.log(JSON.stringify(await qqBindCode({ workspace: input.workspace, ttlMinutes: Number(input.ttl), replace: Boolean(input.replace) })));
    });
  return program;
}

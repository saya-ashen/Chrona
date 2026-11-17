#!/usr/bin/env bun
import { $ } from "bun";
import { resolve } from "node:path";
import { buildTargets } from "../build/manifest";
import { restoreApplications } from "./restore-applications";

const ROOT = resolve(import.meta.dirname, "..");
type Command = { description: string; steps: string[][] };
const command = (description: string, ...steps: string[][]): Command => ({ description, steps });
const binary = (target?: string) => command("Build steward binary", ["scripts/build-binaries.ts", ...(target ? ["--target", target] : [])]);
const types = [["x", "tsc", "--noEmit", "--pretty", "false"]];
const boundaries = [
  "x", "dependency-cruiser", "apps", "packages/contracts", "packages/db", "packages/domain",
  "packages/kernel", "packages/host", "apps/cli", "packages/shared",
  "packages/logging", "packages/pi", "packages/process", "packages/git-workspaces",
  "packages/remote-device", "packages/remote-model",
];
export const TEST_COMMANDS: Record<string, Command> = {
  bun: command("Bun tests", ["scripts/run-bun-tests.ts"]),
  api: command("API tests", ["scripts/run-api-tests.ts"]),
};
TEST_COMMANDS.all = command("Steward test suites", ...Object.values(TEST_COMMANDS).flatMap(c => c.steps));
export const COMMANDS: Record<string, Partial<Record<string, Command>>> = {
  dev: {
    all: command("Server (the web page is the ordinary preinstalled Web application)", ["--watch", "apps/server/src/index.bun.ts"]),
  },
  build: {
    all: binary(),
    helper: command("Build the source POSIX process guardian (Windows backend unavailable)", ["packages/process/scripts/build-helper.ts"]),
    smoke: command("Release smoke", ["build/release-smoke.ts"]),
    ...Object.fromEntries(Object.keys(buildTargets).map(t => [t, binary(t)])),
  },
  check: {
    all: command("Types, lint, guardrails and boundaries", ...types, ["scripts/lint-ratchet.ts"], ["scripts/check-guardrails.ts"], boundaries),
    types: command("Types", ...types),
    lint: command("Lint ratchet", ["scripts/lint-ratchet.ts"]),
    guardrails: command("Sync, hygiene and closure guardrails", ["scripts/check-guardrails.ts"]),
    slice: command("Verify workspace or target slice", ["scripts/verify-slice.ts"]),
    boundaries: command("Package boundaries", boundaries),
    deadcode: command("Dead code (advisory)", ["x", "knip", "--no-progress"]),
  },
  test: TEST_COMMANDS,
  db: {
    seed: command("Seed steward", ["prisma/seed.ts"]),
    generate: command("Generate Prisma", ["x", "prisma", "generate"]),
  },
  doctor: { all: command("Local runtime diagnostics", ["apps/cli/src/bun-entry.ts", "doctor"]) },
};
function printGroupHelp(commands: Partial<Record<string, Command>>) {
  for (const [key, value] of Object.entries(commands)) {
    if (value) console.log(`  ${key}: ${value.description}`);
  }
}

function commandGroup(group: string): Partial<Record<string, Command>> {
  const groups: Partial<typeof COMMANDS> = COMMANDS;
  const commands = groups[group];
  if (!commands) throw new Error(`Unknown command group: ${group}`);
  return commands;
}

export async function main() {
  const args = process.argv.slice(2);
  const separator = args.indexOf("--");
  const lookup = separator < 0 ? args : args.slice(0, separator);
  const extra = separator < 0 ? [] : args.slice(separator + 1);
  const [group, name = "all"] = lookup;
  if (!group || ["--help", "-h", "help"].includes(group)) {
    console.log("Usage: bun scripts/chrona.ts <group> [command] [-- extra args]");
    for (const [key, commands] of Object.entries(COMMANDS)) console.log(`  ${key}: ${Object.keys(commands).join(", ")}`);
    return;
  }
  const commands = commandGroup(group);
  if (["--help", "-h", "help"].includes(name)) {
    printGroupHelp(commands);
    return;
  }
  const selected = commands[name];
  if (!selected) throw new Error(`Unknown ${group} command: ${name}`);
  if (extra.length && selected.steps.length !== 1) throw new Error("Extra args require a single-step command");
  await restoreApplications();
  for (const step of selected.steps) await $`bun ${[...step, ...extra]}`.cwd(ROOT);
}
if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

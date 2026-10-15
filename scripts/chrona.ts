#!/usr/bin/env bun
import { $ } from "bun";
import { resolve } from "node:path";
import { buildTargets } from "../build/manifest";

const ROOT = resolve(import.meta.dirname, "..");
type Command = { description: string; steps: string[][] };
const command = (description: string, ...steps: string[][]): Command => ({ description, steps });
const binary = (target?: string) => command("Build steward binary", ["scripts/build-binaries.ts", ...(target ? ["--target", target] : [])]);
const types = [["x", "tsc", "--noEmit", "--pretty", "false"], ["x", "tsc", "--project", "e2e/tsconfig.json", "--noEmit", "--pretty", "false"]];
const boundaries = ["x", "dependency-cruiser", "apps", "features/steward", "packages/contracts", "packages/db", "packages/domain", "packages/engine", "packages/integrations", "packages/cli", "packages/i18n", "packages/shared", "packages/logging", "shared/ui"];
export const TEST_COMMANDS: Record<string, Command> = {
  unit: command("Unit tests", ["x", "vitest", "run"]),
  bun: command("Bun tests", ["scripts/run-bun-tests.ts"]),
  api: command("API tests", ["scripts/run-api-tests.ts"]),
  e2e: command("Steward browser loop", ["x", "playwright", "test", "--config", "playwright.steward.config.ts"]),
};
TEST_COMMANDS.all = command("Steward test suites", ...Object.values(TEST_COMMANDS).flatMap(c => c.steps));
export const COMMANDS: Record<string, Partial<Record<string, Command>>> = {
  dev: {
    all: command("API and web", ["scripts/dev.ts"]),
    web: command("Web dev", ["run", "--cwd", "apps/web", "dev"]),
    server: command("API dev", ["apps/server/src/index.bun.ts"]),
  },
  build: {
    all: binary(), web: command("Build web", ["run", "--cwd", "apps/web", "build"]),
    smoke: command("Release smoke", ["build/release-smoke.ts"]),
    ...Object.fromEntries(Object.keys(buildTargets).map(t => [t, binary(t)])),
  },
  check: {
    all: command("Types, lint and boundaries", ...types, ["scripts/lint-ratchet.ts"], boundaries),
    types: command("Types", ...types),
    lint: command("Lint ratchet", ["scripts/lint-ratchet.ts"]),
    boundaries: command("Package boundaries", boundaries),
  },
  test: TEST_COMMANDS,
  db: {
    seed: command("Seed steward", ["prisma/seed.ts"]),
    generate: command("Generate Prisma", ["x", "prisma", "generate"]),
  },
  doctor: { all: command("Local runtime diagnostics", ["packages/cli/src/bun-entry.ts", "doctor"]) },
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
  for (const step of selected.steps) await $`bun ${[...step, ...extra]}`.cwd(ROOT);
}
if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

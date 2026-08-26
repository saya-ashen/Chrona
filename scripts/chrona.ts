#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { buildTargets } from "../build/manifest";

export type CommandStep = {
  label: string;
  run: (extraArgs: string[]) => Promise<void>;
  acceptsExtraArgs?: boolean;
};

export type Command = {
  description: string;
  steps: CommandStep[];
};

type CommandGroup = Partial<Record<string, Command>>;

const ROOT = resolve(import.meta.dirname, "..");

function bunStep(label: string, args: string[], acceptsExtraArgs = false): CommandStep {
  return {
    label,
    acceptsExtraArgs,
    run: async (extraArgs) => {
      await $`bun ${[...args, ...(acceptsExtraArgs ? extraArgs : [])]}`.cwd(ROOT);
    },
  };
}
function bunxStep(label: string, args: string[], acceptsExtraArgs = false): CommandStep {
  return {
    label,
    acceptsExtraArgs,
    run: async (extraArgs) => {
      await $`bunx ${[...args, ...(acceptsExtraArgs ? extraArgs : [])]}`.cwd(ROOT);
    },
  };
}


function dependencyCruiserStep(label: string, acceptsExtraArgs = false): CommandStep {
  return {
    label,
    acceptsExtraArgs,
    run: async (extraArgs) => {
      const roots = ["apps", "packages", "features", "shared"].filter((path) => existsSync(resolve(ROOT, path)));
      await $`bun ${["x", "dependency-cruiser", ...roots, ...(acceptsExtraArgs ? extraArgs : [])]}`.cwd(ROOT);
    },
  };
}

function binaryCommand(target?: string): Command {
  return {
    description: target ? `Build ${target} binary` : "Build binary for current platform",
    steps: [bunStep(target ? `build binary ${target}` : "build binary", ["run", "scripts/build-binaries.ts", ...(target ? ["--target", target] : [])])],
  };
}

export const TEST_COMMANDS: CommandGroup = {
  all: {
    description: "Unit, Bun, API, Playwright e2e tests",
    steps: [
      bunxStep("vitest unit tests", ["vitest", "run"]),
      bunStep("bun tests", ["run", "scripts/run-bun-tests.ts"]),
      bunStep("api tests", ["run", "scripts/run-api-tests.ts"]),
      bunStep("playwright e2e", ["x", "playwright", "test"]),
    ],
  },
  ci: {
    description: "CI unit coverage, Bun, API, and LLM replay tests",
    steps: [
      bunxStep("vitest unit coverage", ["vitest", "run", "--coverage", "--reporter=verbose"]),
      bunStep("bun tests", ["run", "scripts/run-bun-tests.ts"]),
      bunStep("api tests", ["run", "scripts/run-api-tests.ts"]),
      bunStep("llm replay tests", ["test", "packages/engine/src/test/llm-fixtures.bun.test.ts"]),
    ],
  },
  unit: { description: "Vitest unit tests", steps: [bunxStep("vitest unit tests", ["vitest", "run"], true)] },
  web: { description: "Vitest coverage", steps: [bunxStep("vitest coverage", ["vitest", "run", "--coverage"], true)] },
  watch: { description: "Vitest watch mode", steps: [bunxStep("vitest watch", ["vitest"], true)] },
  api: { description: "Sequential API Bun tests", steps: [bunStep("api tests", ["run", "scripts/run-api-tests.ts"], true)] },
  bun: { description: "All Bun-only tests", steps: [bunStep("bun tests", ["run", "scripts/run-bun-tests.ts"], true)] },
  e2e: { description: "Playwright e2e tests", steps: [bunStep("playwright e2e", ["x", "playwright", "test"], true)] },
  desktop: { description: "Playwright desktop viewport", steps: [bunStep("playwright desktop", ["x", "playwright", "test", "--project=chromium"], true)] },
  tablet: { description: "Playwright tablet viewport", steps: [bunStep("playwright tablet", ["x", "playwright", "test", "--project=tablet"], true)] },
  mobile: { description: "Playwright mobile viewport", steps: [bunStep("playwright mobile", ["x", "playwright", "test", "--project=mobile"], true)] },
  "llm:record": { description: "Record LLM fixtures", steps: [bunStep("llm record", ["test", "packages/engine/src/test/llm-fixtures.bun.test.ts", "--record"], true)] },
  "llm:replay": { description: "Replay LLM fixtures", steps: [bunStep("llm replay", ["test", "packages/engine/src/test/llm-fixtures.bun.test.ts"], true)] },
};

const BUILD_BINARY_COMMANDS = Object.fromEntries(
  Object.keys(buildTargets).map((target) => [target, binaryCommand(target)]),
) as CommandGroup;

export const COMMANDS: Record<string, CommandGroup> = {
  dev: {
    all: { description: "Run API and web dev servers", steps: [bunStep("dev servers", ["run", "scripts/dev.ts"], true)] },
    web: { description: "Run Vite web dev server", steps: [bunStep("web dev", ["run", "--cwd", "apps/web", "dev"], true)] },
    server: { description: "Run API server", steps: [bunStep("api dev", ["run", "apps/server/src/index.ts"], true)] },
  },
  build: {
    all: {
      description: "Build web app and binary for current platform",
      steps: [bunStep("build web", ["run", "--cwd", "apps/web", "build"]), bunStep("build binary", ["run", "scripts/build-binaries.ts"])],
    },
    web: { description: "Build web app", steps: [bunStep("build web", ["run", "--cwd", "apps/web", "build"], true)] },
    smoke: { description: "Smoke test release artifacts", steps: [bunStep("release smoke", ["run", "build/release-smoke.ts"], true)] },
    ...BUILD_BINARY_COMMANDS,
  },
  binary: {
    current: binaryCommand(),
    ...BUILD_BINARY_COMMANDS,
  },
  check: {
    all: {
      description: "Typecheck, lint, boundaries, and UI foundation",
      steps: [
        bunStep("typecheck", ["x", "tsc", "--noEmit", "--pretty", "false"]),
        bunStep("e2e typecheck", ["x", "tsc", "--project", "e2e/tsconfig.json", "--noEmit", "--pretty", "false"]),
        bunStep("lint ratchet", ["run", "scripts/lint-ratchet.ts"]),
        dependencyCruiserStep("boundaries"),
        bunStep("ui foundation", ["run", "scripts/check-ui-foundation.mjs"]),
        bunStep("release consistency", ["run", "scripts/check-release-consistency.ts"]),
      ],
    },
    types: {
      description: "Application and E2E TypeScript typecheck",
      steps: [
        bunStep("typecheck", ["x", "tsc", "--noEmit", "--pretty", "false"]),
        bunStep("e2e typecheck", ["x", "tsc", "--project", "e2e/tsconfig.json", "--noEmit", "--pretty", "false"]),
      ],
    },
    lint: { description: "ESLint changed-file zero-warning ratchet", steps: [bunStep("lint ratchet", ["run", "scripts/lint-ratchet.ts"], true)] },
    boundaries: { description: "Package and feature boundary checks", steps: [dependencyCruiserStep("boundaries", true)] },
    ui: { description: "UI foundation rules", steps: [bunStep("ui foundation", ["run", "scripts/check-ui-foundation.mjs"], true)] },
    release: { description: "Release/tag/package/migration consistency", steps: [bunStep("release consistency", ["run", "scripts/check-release-consistency.ts"], true)] },
  },
  test: TEST_COMMANDS,
  db: {
    seed: { description: "Seed database", steps: [bunStep("seed database", ["prisma/seed.ts"], true)] },
    fixtures: { description: "Seed graph fixtures", steps: [bunStep("seed graph fixtures", ["scripts/seed-plan-graph-fixtures.ts"], true)] },
    generate: { description: "Generate Prisma client", steps: [bunStep("prisma generate", ["x", "prisma", "generate"], true)] },
    push: { description: "Push Prisma schema", steps: [bunStep("prisma db push", ["x", "prisma", "db", "push"], true)] },
    migrate: { description: "Run Prisma migrate dev", steps: [bunStep("prisma migrate dev", ["x", "prisma", "migrate", "dev"], true)] },
  },
  llm: {
    record: TEST_COMMANDS["llm:record"],
    replay: TEST_COMMANDS["llm:replay"],
  },
  demo: {
    "readme-gif": { description: "Record README demo GIF", steps: [bunStep("readme gif", ["scripts/demo/readme-gif.ts"], true)] },
  },
  plugin: {
    hermes: { description: "Install Hermes plugin", steps: [{ label: "install Hermes plugin", acceptsExtraArgs: true, run: async (extraArgs) => { await $`bash ${["external-plugins/hermes/install.sh", ...extraArgs]}`.cwd(ROOT); } }] },
  },
};

function printHelp() {
  console.log(`Chrona command runner

Usage:
  bun run chrona <group> [command] [-- extra args]
  bun run chrona <group>

Examples:
  bun run chrona test
  bun run chrona dev all
  bun run chrona test api
  bun run chrona test e2e -- --headed
  bun run chrona check ui
  bun run chrona db migrate
  bun run chrona binary linux-x64
  bun run chrona build smoke
Groups:`);

  for (const [group, commands] of Object.entries(COMMANDS)) {
    const names = Object.keys(commands).join(", ");
    console.log(`  ${group.padEnd(8)} ${names}`);
  }
}

function printGroupHelp(group: string, commands: CommandGroup) {
  console.log(`Chrona ${group} commands

Usage:
  bun run chrona ${group} <command> [-- extra args]

Commands:`);

  for (const [name, command] of Object.entries(commands)) {
    if (!command) continue;
    console.log(`  ${name.padEnd(12)} ${command.description}`);
  }
}

export function normalizeArgs(args: string[]) {
  const separator = args.indexOf("--");
  if (separator === -1) {
    return { commandArgs: args, passthrough: [] };
  }
  return { commandArgs: args.slice(0, separator), passthrough: args.slice(separator + 1) };
}

function isHelpArg(arg: string | undefined) {
  return !arg || arg === "help" || arg === "--help" || arg === "-h";
}

export function resolveCommand(commandArgs: string[]) {
  const [group, maybeName] = commandArgs;
  if (isHelpArg(group)) {
    return null;
  }

  const commands = COMMANDS[group];

  const defaultCommand = commands.all;
  if (!maybeName && defaultCommand) {
    return defaultCommand;
  }

  const names = Object.keys(commands);
  if (isHelpArg(maybeName)) {
    printGroupHelp(group, commands);
    return undefined;
  }

  const command = commands[maybeName];
  if (!command) {
    throw new Error(`Unknown ${group} command '${maybeName}'. Available: ${names.join(", ")}`);
  }
  return command;
}

export async function runCommand(command: Command, passthrough: string[]) {
  if (passthrough.length > 0 && command.steps.length !== 1) {
    throw new Error("Extra args '--' only single-step commands.");
  }

  for (const step of command.steps) {
    if (passthrough.length > 0 && !step.acceptsExtraArgs) {
      throw new Error(`Command '${step.label}' does not accept extra args.`);
    }
    try {
      await step.run(passthrough);
    } catch (error) {
      throw new Error(`Command step failed: ${step.label}`, { cause: error });
    }
  }
}

export async function main() {
  const { commandArgs, passthrough } = normalizeArgs(process.argv.slice(2));
  const command = resolveCommand(commandArgs);
  if (!command) {
    if (command === null) printHelp();
    return;
  }
  await runCommand(command, passthrough);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

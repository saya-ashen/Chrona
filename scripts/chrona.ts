#!/usr/bin/env bun

type Command = {
  description: string;
  run: string[];
};

type CommandGroup = Partial<Record<string, Command>>;

export const TEST_COMMANDS: CommandGroup = {
  all: { description: "Unit, Bun, API, and Playwright e2e tests", run: ["bun", "x", "vitest", "run", "&&", "bun", "run", "scripts/run-bun-tests.ts", "&&", "bun", "run", "scripts/run-api-tests.ts", "&&", "bun", "x", "playwright", "test"] },
  ci: { description: "CI unit, Bun, API, and LLM replay tests", run: ["bun", "x", "vitest", "run", "--reporter=verbose", "&&", "bun", "run", "scripts/run-bun-tests.ts", "&&", "bun", "run", "scripts/run-api-tests.ts", "&&", "bun", "test", "packages/engine/src/test/llm-fixtures.bun.test.ts"] },
  unit: { description: "Vitest unit tests", run: ["bun", "x", "vitest", "run"] },
  web: { description: "Vitest with coverage", run: ["bun", "x", "vitest", "run", "--coverage"] },
  watch: { description: "Vitest watch mode", run: ["bun", "x", "vitest"] },
  api: { description: "Sequential API Bun tests", run: ["bun", "run", "scripts/run-api-tests.ts"] },
  bun: { description: "All Bun-only tests", run: ["bun", "run", "scripts/run-bun-tests.ts"] },
  e2e: { description: "Playwright e2e tests", run: ["bun", "x", "playwright", "test"] },
  desktop: { description: "Playwright desktop viewport", run: ["bun", "x", "playwright", "test", "--project=chromium"] },
  tablet: { description: "Playwright tablet viewport", run: ["bun", "x", "playwright", "test", "--project=tablet"] },
  mobile: { description: "Playwright mobile viewport", run: ["bun", "x", "playwright", "test", "--project=mobile"] },
  "llm:record": { description: "Record LLM fixtures", run: ["bun", "run", "scripts/record-llm-fixtures.ts"] },
  "llm:replay": { description: "Replay LLM fixtures", run: ["bun", "test", "packages/engine/src/test/llm-fixtures.bun.test.ts"] },
};

const COMMANDS: Partial<Record<string, CommandGroup>> = {
  dev: {
    all: { description: "Web and API dev servers", run: ["bun", "run", "scripts/dev.ts"] },
    web: { description: "Vite web dev server", run: ["bun", "run", "--cwd", "apps/web", "dev", "--host", "0.0.0.0"] },
    server: { description: "Watched API server", run: ["bun", "--watch", "apps/server/src/index.bun.ts"] },
  },
  server: {
    dev: { description: "Watched API server", run: ["bun", "--watch", "apps/server/src/index.bun.ts"] },
    start: { description: "Start API server", run: ["bun", "run", "apps/server/src/index.bun.ts"] },
    "bundle-check": { description: "Verify web bundle exists", run: ["test", "-f", "apps/web/dist/index.html"] },
  },
  build: {
    web: { description: "Build web app", run: ["bun", "run", "--cwd", "apps/web", "build"] },
    full: { description: "Build web app and verify server bundle", run: ["bun", "run", "--cwd", "apps/web", "build", "&&", "test", "-f", "apps/web/dist/index.html"] },
    npm: { description: "Build npm package", run: ["bun", "run", "scripts/build-npm.ts"] },
    cli: { description: "Build CLI package", run: ["bun", "build", "packages/cli/src/index.ts", "packages/cli/src/bun-entry.ts", "packages/cli/src/npm-launcher.ts", "--outdir=packages/cli/dist", "--target=bun", "--tsconfig-override=tsconfig.json"] },
  },
  binary: {
    current: { description: "Build binary for current platform", run: ["bun", "run", "scripts/build-binaries.ts"] },
    "linux-x64": { description: "Build linux x64 binary", run: ["bun", "run", "scripts/build-binaries.ts", "--target", "linux-x64"] },
    "linux-arm64": { description: "Build linux arm64 binary", run: ["bun", "run", "scripts/build-binaries.ts", "--target", "linux-arm64"] },
    "darwin-x64": { description: "Build macOS x64 binary", run: ["bun", "run", "scripts/build-binaries.ts", "--target", "darwin-x64"] },
    "darwin-arm64": { description: "Build macOS arm64 binary", run: ["bun", "run", "scripts/build-binaries.ts", "--target", "darwin-arm64"] },
    "windows-x64": { description: "Build Windows x64 binary", run: ["bun", "run", "scripts/build-binaries.ts", "--target", "windows-x64"] },
  },
  check: {
    all: { description: "Typecheck, lint, deadcode, pages, boundaries", run: ["bun", "x", "tsc", "--noEmit", "--pretty", "false", "&&", "bun", "x", "eslint", ".", "&&", "bun", "x", "knip", "--include", "unresolved,duplicates", "&&", "bun", "run", "scripts/check-web-page-reachability.ts", "&&", "bun", "x", "dependency-cruiser", "--config", ".dependency-cruiser.cjs", "apps", "packages"] },
    type: { description: "TypeScript typecheck", run: ["bun", "x", "tsc", "--noEmit", "--pretty", "false"] },
    lint: { description: "ESLint", run: ["bun", "x", "eslint", "."] },
    deadcode: { description: "Knip unresolved and duplicate checks", run: ["bun", "x", "knip", "--include", "unresolved,duplicates"] },
    exports: { description: "Knip export checks", run: ["bun", "x", "knip", "--exports"] },
    deps: { description: "Knip dependency checks", run: ["bun", "x", "knip", "--dependencies"] },
    pages: { description: "Web page reachability", run: ["bun", "run", "scripts/check-web-page-reachability.ts"] },
    ui: { description: "UI foundation rules", run: ["bun", "run", "scripts/check-ui-foundation.mjs"] },
    boundaries: { description: "Dependency boundaries", run: ["bun", "x", "dependency-cruiser", "--config", ".dependency-cruiser.cjs", "apps", "packages"] },
  },
  test: TEST_COMMANDS,
  db: {
    seed: { description: "Seed database", run: ["bun", "prisma/seed.ts"] },
    fixtures: { description: "Seed graph fixtures", run: ["bun", "scripts/seed-plan-graph-fixtures.ts"] },
    generate: { description: "Generate Prisma client", run: ["bun", "x", "prisma", "generate"] },
    push: { description: "Push Prisma schema", run: ["bun", "x", "prisma", "db", "push"] },
    migrate: { description: "Run Prisma migrate dev", run: ["bun", "x", "prisma", "migrate", "dev"] },
  },
  llm: {
    record: TEST_COMMANDS["llm:record"],
    replay: TEST_COMMANDS["llm:replay"],
  },
  demo: {
    "readme-gif": { description: "Record README demo GIF", run: ["bun", "scripts/demo/readme-gif.ts"] },
  },
  plugin: {
    hermes: { description: "Install Hermes plugin", run: ["bash", "external-plugins/hermes/install.sh"] },
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

Groups:`);

  for (const [group, commands] of Object.entries(COMMANDS)) {
    if (!commands) {
      continue;
    }
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
    if (!command) {
      continue;
    }
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
  if (!commands) {
    throw new Error(`Unknown group '${group}'. Run 'bun run chrona help'.`);
  }

  const defaultCommand = commands.all;
  if (!maybeName && defaultCommand) {
    return defaultCommand;
  }

  const names = Object.keys(commands);
  if (isHelpArg(maybeName)) {
    printGroupHelp(group, commands);
    return undefined;
  }

  const name = maybeName;
  const command = commands[name];
  if (!command) {
    throw new Error(`Unknown ${group} command '${name}'. Available: ${names.join(", ")}`);
  }
  return command;
}

export async function runSequence(tokens: string[], passthrough: string[]) {
  const chunks: string[][] = [[]];
  for (const token of tokens) {
    if (token === "&&") {
      chunks.push([]);
      continue;
    }
    chunks[chunks.length - 1].push(token);
  }

  if (chunks.length > 1 && passthrough.length > 0) {
    throw new Error("Extra args after '--' are only supported for single-step commands.");
  }

  for (const [index, chunk] of chunks.entries()) {
    const args = index === chunks.length - 1 ? [...chunk, ...passthrough] : chunk;
    const [cmd, ...rest] = args;
    const proc = Bun.spawn([cmd, ...rest], {
      cwd: import.meta.dirname.replace(/\/scripts$/, ""),
      stdio: ["inherit", "inherit", "inherit"],
    });
    const code = await proc.exited;
    if (code !== 0) {
      process.exit(code);
    }
  }
}

export async function main() {
  const { commandArgs, passthrough } = normalizeArgs(process.argv.slice(2));
  const command = resolveCommand(commandArgs);
  if (!command) {
    if (command === null) {
      printHelp();
    }
    return;
  }

  await runSequence(command.run, passthrough);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

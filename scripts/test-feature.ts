#!/usr/bin/env bun

const TEST_KINDS = ["unit", "e2e"] as const;
type TestKind = (typeof TEST_KINDS)[number];
type FeatureTests = Record<TestKind, string[]>;

const FEATURE_TEST_GLOBS: Record<TestKind, string[]> = {
  unit: [
    "features/{feature}/tests/*.bun.test.ts",
    "features/{feature}/tests/*.test.ts",
    "features/{feature}/tests/*.test.tsx",
    "features/{feature}/model/*.test.ts",
    "features/{feature}/model/*.bun.test.ts",
    "features/{feature}/ui/*.test.tsx",
  ],
  e2e: ["features/{feature}/tests/e2e.spec.ts"],
};

const LEGACY_FEATURE_TESTS: Record<string, Partial<FeatureTests>> = {
  "ai-clients": {
    unit: [
      "apps/server/src/__tests__/api/ai-client-crud.bun.test.ts",
      "apps/server/src/__tests__/api/ai-feature-binding.bun.test.ts",
      "features/ai-clients/tests/ai-clients-manager.test.tsx",
      "features/ai-clients/tests/ai-clients-dialog.test.tsx",
      "features/ai-clients/tests/providers.bun.test.ts",
      "features/ai-clients/tests/client-registry.bun.test.ts",
    ],
  },
  "execution-monitoring": {
    unit: [
      "apps/server/src/__tests__/api/execution-checkpoint.bun.test.ts",
      "apps/server/src/__tests__/api/execution-runtime.bun.test.ts",
      "packages/engine/src/modules/plan-execution/execution-checkpoint.bun.test.ts",
      "apps/web/src/components/work/execution-timeline.test.tsx",
      "features/execution-monitoring/tests/workspace-activity-feed.test.tsx",
      "features/execution-monitoring/tests/task-workspace-execution-overview.test.tsx",
      "features/execution-monitoring/tests/current-operation-card.spec.test.tsx",
      "features/execution-monitoring/tests/runtime-event-summary.test.ts",
    ],
  },
  "external-calendar": {
    unit: [
      "apps/server/src/__tests__/api/external-task-edit-roundtrip.bun.test.ts",
      "apps/server/src/__tests__/api/apply-schedule.bun.test.ts",
      "features/schedule/ui/schedule-mini-calendar.test.tsx",
      "packages/domain/src/calendar/planning-busy-blocks.bun.test.ts",
      "packages/engine/src/modules/tasks/__tests__/external-task-description-echo.bun.test.ts",
    ],
  },
  "mcp-control-plane": {
    unit: [
      "packages/contracts/src/api/mcp-task-tools.schema.bun.test.ts",
      "packages/engine/src/modules/agent-tools/agent-control.bun.test.ts",
      "packages/engine/src/modules/agent-tools/node-result-action.bun.test.ts",
      "packages/agent-cli/src/main.bun.test.ts",
      "packages/cli/src/program.bun.test.ts",
      "packages/providers/claude-code/src/runner.mcp-probe.bun.test.ts",
      "packages/providers/claude-code/src/runner.mcp-url.bun.test.ts",
      "apps/web/src/components/__tests__/control-plane-shell.test.tsx",
    ],
  },
  "plan-generation": {
    unit: [
      "apps/server/src/__tests__/api/plan-lifecycle-workflow.bun.test.ts",
      "apps/server/src/__tests__/api/plan-lifecycle-edge-workflow.bun.test.ts",
      "apps/server/src/__tests__/api/plan-acceptance-edges.bun.test.ts",
      "packages/contracts/src/ai-feature-specs.bun.test.ts",
      "packages/engine/src/modules/plans/generate-task-plan-for-task.bun.test.ts",
      "packages/engine/src/modules/plans/materialize-generated-task-plan.bun.test.ts",
      "packages/engine/src/modules/tasks/plan-blueprint-compiler.bun.test.ts",
      "apps/web/src/hooks/ai/task-plan-generation-session-store.test.ts",
      "apps/web/src/components/tasks/workspace/hooks/use-task-workspace-plan-generation-survives-refresh.test.tsx",
    ],
  },
  schedule: {
    unit: [
      "apps/server/src/__tests__/api/apply-schedule.bun.test.ts",
      "apps/server/src/__tests__/api/clear-schedule.bun.test.ts",
      "apps/server/src/__tests__/api/decide-schedule-proposal.bun.test.ts",
      "apps/server/src/__tests__/api/propose-schedule.bun.test.ts",
      "apps/server/src/__tests__/api/schedule-proposal-workflow.bun.test.ts",
      "apps/server/src/__tests__/api/schedule-proposal-accept-reject.bun.test.ts",
      "apps/server/src/__tests__/api/schedule-proposal-conflict-workflow.bun.test.ts",
      "apps/server/src/__tests__/api/schedule-proposal-regression.bun.test.ts",
      "apps/server/src/__tests__/api/work-block-schedule.bun.test.ts",
      "packages/domain/src/task/schedule-proposal-boundaries.bun.test.ts",
      "packages/engine/src/modules/pages/get-schedule-page.bun.test.ts",
      "packages/engine/src/modules/pages/get-schedule-page-auto-start-reason.bun.test.ts",
      "packages/engine/src/modules/pages/get-schedule-page-runnable-state.bun.test.ts",
      "packages/engine/src/modules/scheduling/__tests__/schedule-commands.bun.test.ts",
      "packages/engine/src/modules/scheduling/auto-generate-scheduled-plan.bun.test.ts",
      "packages/engine/src/modules/scheduling/auto-start-scheduled-plan.bun.test.ts",
      "features/schedule/ui/schedule-page.test.tsx",
      "features/schedule/ui/schedule-page-view-model.bun.test.ts",
      "features/schedule/ui/schedule-page-utils.bun.test.ts",
    ],
  },
  "task-workspace": {
    unit: [
      "apps/server/src/__tests__/api/header-and-readmodels-ssr.bun.test.ts",
      "apps/server/src/__tests__/api/task-workspace-activity.bun.test.ts",
      "apps/server/src/__tests__/api/task-workspace-chat.bun.test.ts",
      "apps/server/src/__tests__/api/task-workspace-console.bun.test.ts",
      "apps/server/src/__tests__/api/task-workflow.bun.test.ts",
      "features/task-workspace/tests/task-workspace-activity.test.ts",
      "features/task-workspace/tests/task-workspace-query.test.ts",
      "features/task-workspace/tests/task-workspace-primary-action.test.ts",
      "features/task-workspace/tests/task-workspace-actions.test.ts",
      "features/task-workspace/tests/task-workspace-page.test.tsx",
      "features/task-workspace/tests/task-workspace-header-card.test.tsx",
      "features/task-workspace/tests/task-workspace-live-actions.test.tsx",
    ],
  },
};

function usage(): never {
  console.error("Usage: bun run scripts/test-feature.ts <feature> [--kind unit|e2e] [--run]");
  process.exit(1);
}

function parseArgs(args: string[]) {
  let feature: string | undefined;
  let kind: TestKind | undefined;
  let shouldRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--run") {
      shouldRun = true;
      continue;
    }
    if (arg === "--kind") {
      const next = args[index + 1];
      if (!next || !TEST_KINDS.includes(next as TestKind)) usage();
      kind = next as TestKind;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) usage();
    if (feature) usage();
    feature = arg;
  }

  if (!feature) usage();
  return { feature, kind, shouldRun };
}

async function globFeatureTests(feature: string, kind: TestKind) {
  const paths: string[] = [];
  for (const pattern of FEATURE_TEST_GLOBS[kind]) {
    const glob = new Bun.Glob(pattern.replace("{feature}", feature));
    for await (const path of glob.scan({ cwd: ".", onlyFiles: true })) {
      paths.push(path);
    }
  }
  return paths;
}

async function existing(paths: string[]) {
  const result: string[] = [];
  for (const path of paths) {
    if (await Bun.file(path).exists()) result.push(path);
  }
  return result;
}

async function collectFeatureTests(feature: string): Promise<FeatureTests> {
  const tests: FeatureTests = { unit: [], e2e: [] };
  const legacy = LEGACY_FEATURE_TESTS[feature] ?? {};
  for (const kind of TEST_KINDS) {
    const discovered = await globFeatureTests(feature, kind);
    const mapped = await existing(legacy[kind] ?? []);
    tests[kind] = [...new Set([...discovered, ...mapped])].sort();
  }
  return tests;
}

function printFeatureTests(feature: string, tests: FeatureTests) {
  console.log(`feature: ${feature}`);
  for (const kind of TEST_KINDS) {
    console.log(`${kind}:`);
    if (tests[kind].length === 0) {
      console.log("  (none)");
      continue;
    }
    for (const path of tests[kind]) console.log(`  ${path}`);
  }
}

async function run(paths: string[], kindLabel: TestKind) {
  if (paths.length === 0) return;
  console.log(`running: ${kindLabel}`);
  const bunPaths = paths.filter((path) => !path.endsWith(".test.tsx"));
  const vitestPaths = paths.filter((path) => path.endsWith(".test.tsx"));
  for (const [command, commandPaths] of [
    [["bun", "test"], bunPaths],
    [["bunx", "vitest", "run"], vitestPaths],
  ] as const) {
    if (commandPaths.length === 0) continue;
    const proc = Bun.spawn([...command, ...commandPaths], { stdio: ["inherit", "inherit", "inherit"] });
    const code = await proc.exited;
    if (code !== 0) process.exit(code);
  }
}

const { feature, kind, shouldRun } = parseArgs(process.argv.slice(2));
const tests = await collectFeatureTests(feature);
printFeatureTests(feature, tests);
if (shouldRun) await run(kind ? tests[kind] : tests.unit, kind ?? "unit");
export {};

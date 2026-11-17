const TEST = "(__tests__/|(?:^|/)test\\.ts$|\\.test\\.|\\.bun\\.test\\.|\\.spec\\.)";
const KERNEL_PUBLIC = "^packages/kernel/src/(index|executor|catalog|test-support)\\.ts$";

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "kernel-independent-of-host-and-applications",
      comment: "The server assembles kernel, host and Provider applications; kernel only uses SDK transport contracts.",
      severity: "error",
      from: { path: "^packages/kernel/src/", pathNot: `${TEST}|/test-[^/]+\\.ts$|/module-release-test-fixture\\.ts$` },
      to: { path: "^(apps/|packages/(host|pi|app-common)/|\\.generated/applications/)" },
    },
    {
      name: "domain-stays-pure",
      severity: "error",
      from: { path: "^packages/domain/src/", pathNot: TEST },
      to: { path: "^(node:|packages/(db|kernel|host|logging|app-common)/|apps/|node_modules/(react|@prisma))" },
    },
    {
      name: "contracts-stay-schema-only",
      severity: "error",
      from: { path: "^packages/contracts/src/" },
      to: { path: "^(packages/(kernel|db|host|app-common)/|apps/)" },
    },
    {
      name: "sdk-independent-of-host-and-kernel",
      severity: "error",
      from: { path: "^packages/app-sdk/", pathNot: TEST },
      to: { path: "^(apps/|packages/(kernel|host|db|pi|app-common)/)" },
    },
    {
      name: "packages-never-import-apps",
      severity: "error",
      from: { path: "^packages/", pathNot: TEST },
      to: { path: "^apps/" },
    },
    {
      name: "packages-never-import-apps-tests",
      severity: "warn",
      from: { path: `^packages/.*${TEST}` },
      to: { path: "^apps/" },
    },
    {
      name: "no-deep-import-kernel-internals",
      severity: "error",
      from: { path: "^(apps|packages)/", pathNot: `(^packages/kernel/|${TEST})` },
      to: { path: "^packages/kernel/src/", pathNot: KERNEL_PUBLIC, dependencyTypesNot: ["type-import"] },
    },
    {
      name: "no-deep-import-kernel-internals-tests",
      severity: "warn",
      from: { path: `^(apps|packages)/.*${TEST}`, pathNot: "^packages/kernel/" },
      to: { path: "^packages/kernel/src/", pathNot: KERNEL_PUBLIC },
    },
    {
      name: "no-cross-package-prisma-generated",
      severity: "error",
      from: { path: "^(apps|packages)/", pathNot: `(^packages/db/|${TEST})` },
      to: { path: "^packages/db/src/generated/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|generated/prisma|dist|build|coverage|e2e|\\.worktrees)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    webpackConfig: { fileName: ".dependency-cruiser-resolve.cjs" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
    reporterOptions: { dot: { collapsePattern: "node_modules/[^/]+" } },
  },
};

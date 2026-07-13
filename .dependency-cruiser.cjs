// Architectural boundary rules for the Chrona monorepo.
//
// These encode the package boundaries documented in docs/en/package-boundaries.md
// and docs/en/provider-boundary.md and turn them from convention into a CI gate.
//
// Severity policy:
//   error — boundaries that production (non-test) code already satisfies. A new
//           violation is a regression and fails `bun run check`.
//   warn  — historical debt we tolerate but want visible: intra-package type
//           cycles and test files reaching into another package's internals.
//
// Module specifiers like `@chrona/engine/modules/x` resolve (via tsConfig
// paths) to `packages/engine/src/modules/x`, so rules match on resolved file
// paths, not on the import specifier string.

const { existsSync, readdirSync } = require("node:fs");

function featureNames() {
  if (!existsSync("features")) {
    return [];
  }
  return readdirSync("features", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

const FEATURE_PUBLIC_ENTRYPOINT = "^features/[^/]+/(index|ui|server|test)\\.ts$";
const FEATURE_BROWSER_ENTRYPOINT = "^features/[^/]+/(index|ui)\\.ts$";
const FEATURE_SERVER_ENTRYPOINT = "^features/[^/]+/(index|server)\\.ts$";
const FEATURE_PUBLIC_IMPORT_RULES = featureNames().map((feature) => ({
  name: `feature-${feature}-internals-are-private`,
  comment:
    `Import features/${feature} from sibling features only through its index.ts, ui.ts, server.ts, or test.ts public entrypoint, not internal files or secondary barrels.`,
  severity: "error",
  from: { path: `^features/(?!${feature}/)[^/]+/` },
  to: {
    path: `^features/${feature}/`,
    pathNot: `^features/${feature}/(index|ui|server|test)\\.ts$`,
  },
}));

const FEATURE_OR_SHARED = "^(features|shared)/";
const TEST = "(__tests__/|(?:^|/)test\\.ts$|\\.test\\.|\\.bun\\.test\\.|\\.spec\\.)";
const BROWSER_PATH =
  "^(apps/web/src/|features/[^/]+/(index|ui|browser-api)\\.ts$|features/[^/]+/ui/|shared/ui/)";
const BROWSER_FORBIDDEN_DEPENDENCIES =
  "^(packages/(engine|db|logging|providers)/|apps/server/|shared/http/server\\.ts$|node:)";

/** A package's public entry points (barrels). Importing anything else in the
 *  package from the outside is a boundary violation. */
const ENGINE_PUBLIC = "^packages/engine/src/(index|engine)\\.ts$";
const DB_INTERNAL = "^packages/db/src/(generated/|db\\.ts$)";

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment:
        "Circular dependencies should be avoided. Remaining cycles are intra-package type-only debt; do not add new ones.",
      severity: "warn",
      from: {},
      to: { circular: true },
    },

    // --- packages/domain must stay pure (no IO, no framework, no app) --------
    {
      name: "domain-stays-pure",
      comment:
        "packages/domain is pure business derivation: no Prisma, db, React, providers, engine, or app code. See docs/en/package-boundaries.md.",
      severity: "error",
      from: { path: "^packages/domain/src/" },
      to: {
        path: "^(packages/db/|packages/engine/|packages/providers/|packages/integrations/|apps/|node_modules/(react|@prisma))",
      },
    },

    // --- packages/contracts stays schema/type focused ------------------------
    {
      name: "contracts-stay-schema-only",
      comment:
        "packages/contracts holds shared schemas/DTOs only: no engine, db, providers, integrations, or app imports.",
      severity: "error",
      from: { path: "^packages/contracts/src/" },
      to: {
        path: "^(packages/engine/|packages/db/|packages/providers/|packages/integrations/|apps/)",
      },
    },

    // --- providers adapt protocols, they do not own business semantics -------
    {
      name: "providers-own-no-business",
      comment:
        "Provider packages adapt external protocols. Task lifecycle, plan progression, and projection logic live in packages/engine. See docs/en/provider-boundary.md.",
      severity: "error",
      from: { path: "^packages/providers/", pathNot: TEST },
      to: { path: "^(packages/engine/|packages/domain/|packages/db/|apps/)" },
    },
    {
      name: "providers-own-no-business-tests",
      comment:
        "Provider test files boot real server/engine surfaces for end-to-end coverage (e.g. the aimock MCP recipe). Acknowledged test debt; production code must not.",
      severity: "warn",
      from: { path: `^packages/providers/.*${TEST}` },
      to: { path: "^(packages/engine/|packages/domain/|packages/db/|apps/)" },
    },

    // --- graph-runtime is product-agnostic graph mechanics -------------------
    {
      name: "graph-runtime-owns-no-product",
      comment:
        "packages/graph-runtime owns graph mechanics only: no engine/db/providers/app coupling.",
      severity: "error",
      from: { path: "^packages/graph-runtime/src/" },
      to: {
        path: "^(packages/engine/|packages/db/|packages/providers/|packages/integrations/|apps/)",
      },
    },

    // --- packages never depend on apps ---------------------------------------
    {
      name: "packages-never-import-apps",
      comment:
        "Packages are reusable; they must not depend on an app. The one sanctioned exception is the CLI launcher (packages/cli is documented as a server launcher), which dynamically imports the server entry to boot it.",
      severity: "error",
      from: {
        path: "^packages/",
        // The CLI's sole job is to boot the server (docs/en/architecture.md). Its
        // launcher entry may import the server entrypoint; nothing else may.
        // Test files that boot app surfaces end-to-end are handled by the
        // `-tests` warn variant below.
        pathNot: `^packages/cli/src/bun-entry\\.ts$|${TEST}`,
      },
      to: { path: "^apps/" },
    },
    {
      name: "packages-never-import-apps-tests",
      comment:
        "Package test files import app entrypoints to exercise end-to-end behavior (e.g. provider tests booting the MCP server). Acknowledged test debt; production package code must not.",
      severity: "warn",
      from: { path: `^packages/.*${TEST}` },
      to: { path: "^apps/" },
    },

    {
      name: "domain-stays-runtime-agnostic",
      comment:
        "Domain modules are shared by browser and server code; keep them free of Node builtins and runtime infrastructure such as logging, engine, db, providers, and apps.",
      severity: "error",
      from: { path: "^packages/domain/src/", pathNot: TEST },
      to: {
        path: "^(node:|packages/(logging|engine|db|providers)/|apps/)",
      },
    },

    // --- engine internals are private; consumers use the barrel --------------
    {
      name: "no-deep-import-engine-internals",
      comment:
        "Import engine use cases through the @chrona/engine barrel (createChronaEngine / exported types), not packages/engine/src/modules/*. Production code must comply.",
      severity: "error",
      from: {
        path: "^(apps|packages)/",
        pathNot: `(^packages/engine/|${TEST})`,
      },
      to: {
        path: "^packages/engine/src/",
        pathNot: ENGINE_PUBLIC,
        // Type-only imports are an acceptable end-to-end type contract in this
        // single-repo setup (the web app infers page-builder return types,
        // mirroring the @chrona/server ApiType RPC pattern). Only runtime
        // (value) deep imports couple the build across the encapsulation
        // boundary, so they are the ones we forbid.
        dependencyTypesNot: ["type-import"],
      },
    },
    {
      name: "no-deep-import-engine-internals-tests",
      comment:
        "Test files reach into engine internals (debt). Prefer the @chrona/engine barrel; expose new use cases there instead of deep-importing.",
      severity: "warn",
      from: {
        path: `^(apps|packages)/.*${TEST}`,
        pathNot: "^packages/engine/",
      },
      to: {
        path: "^packages/engine/src/",
        pathNot: ENGINE_PUBLIC,
      },
    },

    // --- db generated client is private to packages/db -----------------------
    {
      name: "no-cross-package-prisma-generated",
      comment:
        "Generated Prisma artifacts are private to packages/db. Import types/values through the @chrona/db barrel, not @chrona/db/generated/*. Production code must comply.",
      severity: "error",
      from: {
        path: "^(apps|packages)/",
        pathNot: `(^packages/db/|${TEST})`,
      },
      to: { path: "^packages/db/src/generated/" },
    },

    // --- capability ("sink") engine modules expose a barrel; respect it ------
    // packages/engine is a large but internally-layered package. A subset of
    // its modules are pure capability *sinks*: they have ZERO outbound
    // dependencies on other engine modules (events, ai, execution-runtime,
    // workspaces). Those are safe to hide behind a barrel — importing them
    // through modules/<sink>/index.ts can never create a cycle, and it lets
    // their internal files move freely.
    //
    // The remaining modules (plan-execution, plans, tasks, scheduling,
    // orchestration, projections) form one mutually-recursive core: tasks
    // creates plans, plans validate tasks, plan-execution writes projections,
    // projections read plan-execution scope, and so on. Forcing THOSE through
    // barrels collapses file-level resolution to the module level and
    // manufactures real import cycles, so the core intentionally keeps direct
    // (deep) imports. Only the sinks are barrel-enforced here.
    {
      name: "engine-sink-modules-via-barrel",
      comment:
        "Import a capability module (events/ai/execution-runtime/workspaces) through its modules/<name>/index.ts barrel, not its internal files. These modules have no cross-module dependencies, so the barrel is cycle-safe; add the symbol to the barrel instead of deep-importing.",
      severity: "error",
      from: {
        path: "^(apps|packages)/",
        pathNot: `(^packages/engine/src/modules/(events|ai|execution-runtime|workspaces)/|${TEST})`,
      },
      to: {
        path: "^packages/engine/src/modules/(events|ai|execution-runtime|workspaces)/",
        pathNot: "^packages/engine/src/modules/(events|ai|execution-runtime|workspaces)/index\\.ts$",
        // Type-only imports are an acceptable end-to-end type contract (e.g. the
        // web app inferring a builder's return type); only runtime imports must
        // route through the barrel.
        dependencyTypesNot: ["type-import"],
      },
    },
    {
      name: "engine-sink-modules-via-barrel-tests",
      comment:
        "Test files reach into capability-module internals (debt). Prefer the module barrel.",
      severity: "warn",
      from: {
        path: `^(apps|packages)/.*${TEST}`,
      },
      to: {
        path: "^packages/engine/src/modules/(events|ai|execution-runtime|workspaces)/",
        pathNot: "^packages/engine/src/modules/(events|ai|execution-runtime|workspaces)/index\\.ts$",
      },
    },

    // --- app consumers use feature public entrypoints only ------------------
    {
      name: "apps-use-feature-public-entrypoints",
      comment:
        "Apps may import a feature only through its index.ts, ui.ts, server.ts, or test.ts public entrypoint; feature internals remain private.",
      severity: "error",
      from: { path: "^apps/" },
      to: {
        path: "^features/",
        pathNot: FEATURE_PUBLIC_ENTRYPOINT,
      },
    },
    {
      name: "feature-test-entrypoints-are-test-only",
      comment:
        "Feature test.ts entrypoints expose test support only; production app, package, feature, and shared code must not import them.",
      severity: "error",
      from: {
        path: "^(apps|packages|features|shared)/",
        pathNot: TEST,
      },
      to: { path: "^features/[^/]+/test\\.ts$" },
    },
    {
      name: "web-uses-browser-safe-feature-entrypoints",
      comment:
        "The browser app may consume feature index.ts or ui.ts entrypoints only; server.ts and test.ts are not browser dependencies.",
      severity: "error",
      from: { path: "^apps/web/src/", pathNot: TEST },
      to: {
        path: "^features/",
        pathNot: FEATURE_BROWSER_ENTRYPOINT,
      },
    },
    {
      name: "server-uses-server-safe-feature-entrypoints",
      comment:
        "The server app may consume feature index.ts or server.ts entrypoints only; UI and test entrypoints are not server dependencies.",
      severity: "error",
      from: { path: "^apps/server/src/", pathNot: TEST },
      to: {
        path: "^features/",
        pathNot: FEATURE_SERVER_ENTRYPOINT,
      },
    },
    {
      name: "browser-paths-stay-server-free",
      comment:
        "Browser-reachable app, feature UI, and shared UI code must not depend on engine, db, Node-oriented logging, providers, server code, shared HTTP server code, or Node builtins.",
      severity: "error",
      from: { path: BROWSER_PATH, pathNot: TEST },
      to: {
        path: BROWSER_FORBIDDEN_DEPENDENCIES,
        dependencyTypesNot: ["type-only"],
      },
    },

    // --- package production code never reaches into root feature slices -----
    {
      name: "packages-production-never-import-root-features",
      comment:
        "Packages are reusable infrastructure; production package code must not depend on root feature slices. Tests may use a feature's test.ts entrypoint only.",
      severity: "error",
      from: { path: "^packages/", pathNot: TEST },
      to: { path: "^features/" },
    },
    {
      name: "package-tests-use-feature-test-entrypoint-only",
      comment:
        "Package tests that need feature integration may import only the feature test.ts entrypoint, keeping test-only reach-through explicit and controlled.",
      severity: "error",
      from: { path: `^packages/.*${TEST}` },
      to: {
        path: "^features/",
        pathNot: "^features/[^/]+/test\\.ts$",
      },
    },
    ...FEATURE_PUBLIC_IMPORT_RULES,

    // --- feature slices expose public barrels for other slices ---------------
    {
      name: "features-do-not-import-apps-or-packages-internals",
      comment:
        "Feature slices must use public package barrels and must not import app or package internals.",
      severity: "error",
      from: { path: "^features/", pathNot: TEST },
      to: {
        path: "^(apps/|packages/[^/]+/src/)",
        pathNot: "^packages/[^/]+/src/index\\.ts$",
        dependencyTypesNot: ["type-import"],
      },
    },
    {
      name: "shared-owns-no-feature-or-app-code",
      comment:
        "shared/ is stable infrastructure used by features; it must not import feature slices, apps, or product package internals.",
      severity: "error",
      from: { path: "^shared/", pathNot: TEST },
      to: {
        path: "^(features/|apps/|packages/[^/]+/src/)",
        pathNot: "^packages/[^/]+/src/index\\.ts$",
        dependencyTypesNot: ["type-import"],
      },
    },
    {
      name: "features-and-shared-never-import-apps-tests",
      comment:
        "Feature/shared tests should avoid app internals; keep any temporary test reach-through visible.",
      severity: "warn",
      from: { path: `${FEATURE_OR_SHARED}.*${TEST}` },
      to: { path: "^apps/" },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: "(node_modules|/generated/prisma/|dist|build|apps/web/dist|coverage|e2e|\\.worktrees)",
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/[^/]+" },
    },
  },
};

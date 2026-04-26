module.exports = {
  forbidden: [
    {
      name: "no-components-into-server-modules",
      comment: "Server/application modules must not depend on React component files.",
      severity: "error",
      from: { path: "^packages/runtime/src/modules/(commands|queries|projections|events|workspaces|scheduler|runtime-sync|task-execution)/" },
      to: { path: "^src/components/" },
    },
    {
      name: "no-direct-db-from-api-routes",
      comment: "API routes should call server-layer functions instead of importing Prisma bootstrap directly.",
      severity: "warn",
      from: { path: "^apps/server/src/routes/" },
      to: { path: "^src/lib/db\.ts$" },
    },
    {
      name: "no-react-next-prisma-in-domain",
      comment: "Domain package must stay pure.",
      severity: "error",
      from: { path: "^packages/domain/" },
      to: {
        path: "^(apps/web/src/components/|apps/server/src/|packages/db/src/generated/prisma/|node_modules/react|@prisma/|react)",
      },
    },
    {
      name: "no-provider-leak-into-domain-contracts",
      comment: "OpenClaw/provider details must not leak into domain/contracts packages.",
      severity: "error",
      from: { path: "^packages/(domain|contracts)/" },
      to: { path: "^packages/providers/openclaw/|^packages/runtime-openclaw/|@chrona/openclaw-integration" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "^(coverage|dist|build|packages/db/src/generated/prisma/)"
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+"
      }
    }
  },
};

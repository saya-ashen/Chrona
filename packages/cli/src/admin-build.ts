import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import type { ProviderAdapter } from "@chrona/contracts/steward";
import { createStewardService, ownerBuildSchema, runOwnerBuild } from "@chrona/engine";
import { createStewardRuntime } from "@server/steward-runtime";
import { createStewardAgentRoutes } from "@server/routes/steward-agent.routes";
import { getChronaDataDir } from "./start-server";

type Options = { dataDir?: string; databaseUrl?: string; provider?: ProviderAdapter };
/** Stop the service first. This one-shot recovery path never starts the normal tick or web/QQ modules. */
export async function adminBuild(file: string, options: Options = {}) {
  const request = ownerBuildSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const dataDir = options.dataDir ?? getChronaDataDir(), databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? `file:${join(dataDir, "chrona.db")}`;
  const path = sqlitePathFromFileUrl(databaseUrl);
  if (!path || !existsSync(path)) throw new Error("Chrona database not found");
  const lock = acquireSqliteRuntimeLock(databaseUrl);
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  let server: ReturnType<typeof Bun.serve> | undefined, runtime: ReturnType<typeof createStewardRuntime> | undefined;
  try {
    let app = new Hono();
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: (request, server) => app.fetch(request, { server }) });
    runtime = createStewardRuntime(db, { dataDir, port: server.port!, provider: options.provider });
    // The regular runtime is only a configuration assembler, not an autonomous executor here.
    runtime.ports.onQueued = undefined;
    runtime.ports.onRunFinished = undefined;
    const service = createStewardService(runtime.ports);
    app = new Hono().route("/api/steward-agent", createStewardAgentRoutes(runtime.ports, service));
    const receipt = await runOwnerBuild(runtime.ports, "ws_default", request);
    console.log(JSON.stringify(receipt));
    if (!["finished", "approved", "pending_review"].includes(receipt.status)) process.exitCode = 1;
    return receipt;
  } finally {
    await runtime?.stop();
    server?.stop(true);
    await db.$disconnect();
    lock.release();
  }
}

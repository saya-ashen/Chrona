import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createScriptSandbox } from "../../../packages/host/src/runtime/script-sandbox";
import { verifyKernelConsumer } from "../../../scripts/acceptance/kernel-api-consumer";
import { createServerApp } from "./app";
import { createStewardRuntime } from "./steward-runtime";
import { resetEnvCacheForTests } from "./config/env";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";

const bridge = `import { chrona, on } from "chrona";
import { readFile, writeFile } from "node:fs/promises";
on("tool", async event => {
  const path = chrona.paths.data + "/count";
  let count = 0;
  try { count = Number(await readFile(path, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  await writeFile(path, String(++count));
  return { result: { value: event.args.value, count } };
});
chrona.serve(async request => {
  try {
    const body = await request.json();
    const value = body.status ? await chrona.callStatus(body.status) : await chrona.call(body.target, body.args, body.options);
    if (body.loseReply) return new Response("transport lost after durable result", { status: 502 });
    return Response.json({ value });
  } catch (error) { return Response.json({ error: { code: error.code ?? "failed" } }); }
});`;

test("independent consumer crosses HTTP and real SDK, then resumes persisted receipts after host restart", async () => {
  const saved = process.env.API_KEY, dataDir = await mkdtemp("/tmp/chrona-consumer-");
  const databaseUrl = `file:${join(dataDir, "platform.db")}`;
  ensureSqliteDatabase({ databaseUrl, migrationsDir: join(process.cwd(), "packages/db/prisma/migrations") });
  const connect = () => new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  let db = connect();
  let runtime: ReturnType<typeof createStewardRuntime> | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  process.env.API_KEY = "consumer-fixture-key"; resetEnvCacheForTests();
  try {
    const { id: workspaceId } = await db.workspace.create({ data: { name: "Independent consumer" } });
    const installed = [];
    for (const name of ["consumer-owner", "consumer-ordinary"]) {
      const hash = name + "-v1", code = join(dataDir, "platform/store", hash);
      const manifest = moduleManifestSchema.parse({ name, ...(name === "consumer-owner" ? { authority: "owner" } : {}), entry: "index.ts", tests: ["test.ts"], keepAlive: true, listen: "/api/" + name, effects: [], uses: ["*"], tools: [{ name: "echo", description: "Receipt counter fixture", idempotent: false, visibility: ["modules", "owner"], parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] }, output: { type: "object", properties: { value: { type: "string" }, count: { type: "integer" } }, required: ["value", "count"] } }] });
      const module = await db.module.create({ data: { workspaceId, name, activeHash: hash } });
      await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
      await mkdir(code, { recursive: true }); await writeFile(join(code, "index.ts"), bridge);
      installed.push(module);
    }
    async function restart() {
      server?.stop(true); await runtime?.stop(); await db.$disconnect(); db = connect();
      const selected = createScriptSandbox({ dataDir, executionMode: "trusted-local" });
      runtime = createStewardRuntime(db, { dataDir, sandbox: { ...selected.health, startModule: selected.startModule } });
      const app = await createServerApp({ steward: runtime });
      server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
    }
    await restart();
    expect((await fetch(`http://127.0.0.1:${server!.port}/api/consumer-owner`)).status).toBe(401);
    const result = await verifyKernelConsumer({
      target: { moduleId: installed[1]!.id, tool: "echo" }, restart,
      async loseReply(caller, body) {
        const response = await fetch(`http://127.0.0.1:${server!.port}/api/consumer-${caller}`, { method: "POST", headers: { authorization: "Bearer consumer-fixture-key", "content-type": "application/json" }, body: JSON.stringify({ ...body, loseReply: true }) });
        expect(response.status).toBe(502);
      },
      async request(caller, body) {
        const response = await fetch(`http://127.0.0.1:${server!.port}/api/consumer-${caller}`, { method: "POST", headers: { authorization: "Bearer consumer-fixture-key", "content-type": "application/json" }, body: JSON.stringify(body) });
        expect(response.status).toBe(200); return response.json();
      },
    });
    expect(result.restart).toBe(true);
  } finally {
    server?.stop(true); await runtime?.stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.API_KEY; else process.env.API_KEY = saved;
    resetEnvCacheForTests();
  }
}, 60000);

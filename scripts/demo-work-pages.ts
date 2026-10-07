#!/usr/bin/env bun
/** Disposable, loopback-only maintainer demo. Never reuse a normal Chrona database. */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const serve = args.includes("--serve");
const dirIndex = args.indexOf("--data-dir");
if (dirIndex < 0 || !args[dirIndex + 1] || args.some((arg, index) => index !== dirIndex + 1 && !["--serve", "--data-dir"].includes(arg))) {
  throw new Error("Usage: bun run scripts/demo-work-pages.ts [--serve] --data-dir <NEW-directory>");
}
const directory = resolve(args[dirIndex + 1]!);
const databaseUrl = `file:${join(directory, "chrona.db")}`;
const markerPath = join(directory, "demo.json");
const webOrigin = "http://127.0.0.1:43200";
const apiOrigin = "http://127.0.0.1:43201";

function environment(): NodeJS.ProcessEnv {
  // Do not pass production config, bearer/provider credentials or test flags to the server.
  return {
    PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG ?? "en_US.UTF-8",
    NODE_ENV: "development", TZ: "Asia/Shanghai",
    CHRONA_CONFIG_FILE: join(directory, "config.json"), CHRONA_CONFIG_DIR: directory,
    CHRONA_DATA_DIR: directory, DATABASE_URL: databaseUrl,
    CHRONA_MIGRATIONS_DIR: join(root, "prisma/migrations"),
    HOST: "127.0.0.1", PORT: "43201", ALLOWED_ORIGINS: webOrigin,
    VITE_API_BASE_URL: apiOrigin, CHRONA_WEB_PORT: "43200",
    CHRONA_TASK_ORCHESTRATOR_ENABLED: "false", CHRONA_ENABLE_DEBUG_PROVIDER: "false",
    CHRONA_EXPERIMENTAL_DASHBOARD_AI_SUMMARY: "false",
    CHRONA_RESULT_WRITES_ENABLED: "true", CHRONA_WORK_WRITES_ENABLED: "true",
    CHRONA_WORK_PAGES_WRITES_ENABLED: "true", CHRONA_LIBRARY_WRITES_ENABLED: "true",
  };
}
function privateJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
}
async function seed() {
  // Atomic mkdir: refuses even an empty pre-existing directory, including symlinks.
  if (existsSync(directory)) throw new Error("Refusing an existing directory. Choose a new disposable demo directory.");
  if (realpathSync(dirname(directory)) !== dirname(directory)) throw new Error("Use a canonical parent path, not a symlink.");
  mkdirSync(directory, { mode: 0o700 });
  privateJson(join(directory, "config.json"), {});
  Object.assign(process.env, environment());
  delete process.env.CHRONA_AUTO_TEST_DATABASE_URL;
  const { ensureSqliteDatabase } = await import("../packages/db/src/sqlite-migrations");
  ensureSqliteDatabase({ databaseUrl, migrationsDir: join(root, "prisma/migrations") });
  const { db } = await import("@chrona/db");
  try {
    const { createLocalWorkRecordsService } = await import("../packages/engine/src/modules/work-records/local-owner");
    const work = createLocalWorkRecordsService(async () => true);
    const captured = await work.capture({ requestId: crypto.randomUUID(), title: "配一台新电脑（虚构演示）", context: { kind: "general" }, nextAction: "先和家里商量购买时间；此演示不会购买或发送通知。" });
    const taskId = captured.receipt.taskId;
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    const { createTaskResultsService } = await import("../packages/engine/src/modules/results/service");
    const { exampleWorkPage } = await import("@chrona/ui-protocol/work-pages/example");
    const author = createTaskResultsService({ authorize: async () => ({ workspaceId: task.workspaceId, actorKind: "external", actorId: "fictional-demo-author", permissions: ["results:read", "results:write", "pages:read", "pages:write"] }) });
    const published = await author.publish({ taskId, requestId: crypto.randomUUID(), expectedRevision: null,
      content: { schemaVersion: 1, outcome: { title: "电脑配置与购买方案", summary: "方案已经整理好。先读配置，再记下和家里商量后的想法。" },
        readiness: { status: "partial", summary: "虚构示例：未查询电商、未验证硬件兼容，也没有下单。" },
        caveats: [{ key: "fictional", content: "所有型号、价格、预算和选择均为演示数据，不是用户真实需求或实时报价。" }], page: exampleWorkPage },
      source: { label: "虚构 Agent 演示" },
    });
    const { createLibraryService } = await import("../packages/engine/src/modules/library/service");
    const libraryOwner = createLibraryService({ authorize: async () => ({ workspaceId: task.workspaceId, actorKey: "owner:demo", isOwner: true, canOrganize: true, canConfigure: true }) });
    const libraryAgent = createLibraryService({ authorize: async () => ({ workspaceId: task.workspaceId, actorKey: "external:fictional-demo-author", isOwner: false, canOrganize: true, canConfigure: false }) });
    const groupIds: Record<string, string> = {};
    for (const name of ["主题", "归属"]) {
      const created = await libraryOwner.write({ requestId: crypto.randomUUID(), expectedRevision: (await libraryOwner.read({ view: "catalog" })).revision, action: { type: "group_create", name, instructions: "虚构演示分类；真实使用时由用户选择自己的分类方案。", allowAgentFolders: true } });
      groupIds[name] = created.receipt.changes[0]!.groupId!;
    }
    const placement = await libraryAgent.write({ requestId: crypto.randomUUID(), expectedRevision: (await libraryAgent.read({ view: "catalog" })).revision, action: { type: "assign", taskId, placements: [
      { groupId: groupIds["主题"], destination: { type: "create", name: "设备数码", description: "设备选购与使用方案" } },
      { groupId: groupIds["归属"], destination: { type: "create", name: "家庭", description: "仅为演示，不代表真实归属" } },
    ] } });
    for (const name of ["出行", "学习资料"]) await libraryOwner.write({ requestId: crypto.randomUUID(), expectedRevision: (await libraryOwner.read({ view: "catalog" })).revision, action: { type: "folder_create", groupId: groupIds["主题"], name } });
    const counts = { providers: await db.aiClient.count(), runs: await db.run.count(), plans: await db.taskPlan.count(), sessions: await db.executionSession.count(), reviews: await db.taskResultReview.count(), schedules: await db.workBlock.count() };
    if (Object.values(counts).some(Boolean) || task.taskExecutionMode !== "manual" || task.autoExecute || task.autoPlanGeneration) throw new Error("Demo isolation assertion failed");
    const receipt = { kind: "chrona-work-pages-disposable-demo-v1", directory, databaseUrl, taskId, versionId: published.receipt.versionId, libraryGroups: groupIds, classificationReceipt: placement.receipt, counts, createdAt: new Date().toISOString() };
    privateJson(markerPath, receipt);
    console.log(JSON.stringify({ ...receipt, pageUrl: `${webOrigin}/zh/tasks/${taskId}/page`, start: `bun run scripts/demo-work-pages.ts --serve --data-dir ${JSON.stringify(directory)}` }, null, 2));
  } finally { await db.$disconnect(); }
}
async function start() {
  if (realpathSync(directory) !== directory || !lstatSync(directory).isDirectory()) throw new Error("Expected the canonical disposable demo directory");
  const marker = JSON.parse(readFileSync(markerPath, "utf8")) as Record<string, unknown>;
  if (marker.kind !== "chrona-work-pages-disposable-demo-v1" || marker.directory !== directory || marker.databaseUrl !== databaseUrl || lstatSync(join(directory, "chrona.db")).isSymbolicLink()) throw new Error("Not a disposable work-pages demo");
  const env = environment();
  const web = Bun.spawn(["bun", "run", "--cwd", "apps/web", "dev", "--host", "127.0.0.1", "--port", "43200", "--strictPort"], { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });
  const server = Bun.spawn(["bun", "apps/server/src/index.bun.ts"], { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });
  function stop() { web.kill(); server.kill(); }
  process.on("SIGINT", () => { stop(); process.exit(0); });
  process.on("SIGTERM", () => { stop(); process.exit(0); });
  console.log(`Disposable library: ${webOrigin}/zh/home\nContent demo: ${webOrigin}/zh/tasks/${marker.taskId}/page\nLoopback only; no provider or orchestrator. Ctrl-C stops both servers; saved demo notes remain.`);
  const code = await Promise.race([web.exited, server.exited]);
  stop(); process.exitCode = code;
}
if (serve) await start(); else await seed();

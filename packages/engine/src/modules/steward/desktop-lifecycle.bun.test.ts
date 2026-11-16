import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { candidateReceiptSchema } from "../../../../contracts/src/steward/module-candidates";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import runtimes from "../../../../integrations/src/steward/runtimes.json";
import type { BuildReport } from "./module-context";
import type { StewardPorts } from "./ports";

const localTest = process.platform === "linux" ? test : test.skip;
const input = (value: unknown) => ({ input: value });
const intent = { changes: ["Exercise ordinary desktop application lifecycle"], preserves: ["Keep private application data"] };

/** The stand-in needs no display: its detached child stays alive until kernel retirement (or a bounded failsafe). */
function applicationFiles() {
  const manifest = moduleManifestSchema.parse({
    name: "desktop-lifecycle", entry: "index.ts", tests: ["test.ts"], keepAlive: true,
    uses: [], effects: [], data: { schema: 1 },
    tools: ["open", "status"].map(name => ({ name, description: `${name} the bounded window stand-in`, visibility: ["owner"], parameters: { type: "object", properties: {} }, output: { type: "object" } })),
  });
  return {
    "module.json": JSON.stringify(manifest),
    "version.ts": 'export const version = "one";\n',
    "index.ts": `import { chrona, on } from "chrona";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { version } from "./version";
const ledger = join(chrona.paths.data, "opens.json");
let opens: number = existsSync(ledger) ? JSON.parse(readFileSync(ledger, "utf8")) : 0;
let window: ChildProcess | undefined;
on("tool", async event => {
  if (event.id === "open" && !window) {
    // Escape the SDK process group; only descendant supervision can clean this up.
    const child = spawn(process.execPath, ["--no-install", "-e", "setTimeout(() => process.exit(0), 60000)"], { detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref(); window = child;
    writeFileSync(ledger, JSON.stringify(++opens));
  }
  return { result: { version, pid: process.pid, childPid: window?.pid ?? null, opens } };
});
`,
    "test.ts": `import { strict as assert } from "node:assert";
import { startModule } from "chrona/testing";
import { version } from "./version";
const app = await startModule("index.ts");
try {
  const now = new Date().toISOString();
  const reply = await app.send({ trigger: { kind: "tool", id: "status", firedAt: now }, now, params: {} });
  assert.equal(reply.error, undefined);
  const status = reply.result?.result as { version: string; pid: number; childPid: number | null };
  assert.equal(status.version, version);
  assert.ok(status.pid > 0);
  assert.equal(status.childPid, null);
  console.log("checked real SDK status without opening a window");
} finally { await app.stop(); }
`,
  };
}

async function bounded<T>(promise: Promise<T>, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${description} did not complete`)), 5000); })]);
  } finally { clearTimeout(timer); }
}

type Status = { version: string; pid: number; childPid: number | null; opens: number };

// Real owner -> SDK Author -> fixed admission -> checker/install -> SDK subprocess.
// No synthetic peer, forced candidate state, Agent/model, display server or existing database.
localTest("ordinary desktop candidate activation, update and disable stop actual detached window descendants", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-desktop-lifecycle-test-"));
  const databaseUrl = `file:${join(root, "test.db")}`;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  let db: PrismaClient | undefined;
  let importedDatabase: PrismaClient | undefined;
  let stopSupervisor: (() => Promise<void>) | undefined;
  const handles: { codeDir: string; dataDir: string; process: ReturnType<ReturnType<typeof createScriptSandbox>["startModule"]> }[] = [];
  try {
    // Engine imports can open @chrona/db's singleton; bind it to temporary data first.
    const shared = await import("@chrona/db");
    const singletonDatabases = await shared.db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    if (singletonDatabases.find(item => item.name === "main")?.file === join(root, "test.db")) importedDatabase = shared.db;
    const [{ callSync }, { checkoutModule, snapshotModule }, { commitModuleSource }, { moduleSupervisor }, { createModules }, { registerLocalRuntime }, { registerSystemModules }] = await Promise.all([
      import("./module-calls"), import("./module-files"), import("./module-git"), import("./module-supervisor"), import("./modules"), import("./local-runtime"), import("./system-modules"),
    ]);
    await import("./module-effects");
    ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve(import.meta.dir, "../../../../../prisma/migrations") });
    db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
    const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    expect(databases.find(item => item.name === "main")?.file).toBe(join(root, "test.db"));
    const sdk = resolve(import.meta.dir, "../../../../integrations/src/steward/module-sdk");
    const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir: root, moduleSdk: sdk });
    expect(sandbox.health.available).toBe(true);
    const ports: StewardPorts = {
      db, dataDir: root, publicUrl: null, now: () => new Date(), moduleSdk: sdk,
      moduleTypecheck: resolve(import.meta.dir, "../../../../integrations/src/steward/module-typecheck"), moduleRuntimes: runtimes,
      sandbox: { ...sandbox.health, runModule: sandbox.runModule, startModule(options) {
        const process = sandbox.startModule(options);
        handles.push({ codeDir: options.codeDir, dataDir: options.dataDir, process });
        return process;
      } },
    };
    const supervisor = moduleSupervisor(ports);
    stopSupervisor = () => supervisor.stop();
    registerSystemModules(); registerLocalRuntime();
    await symlink(resolve(import.meta.dir, "../../../../../node_modules"), join(root, "node_modules"), "dir");
    const workspaceId = (await db.workspace.create({ data: { name: "Isolated desktop lifecycle acceptance" } })).id;
    const platform = join(root, "platform");
    // Only the known Author fixture is seeded approved. Both application versions go through real checks.
    const authorFiles = await snapshotModule(import.meta.dir, "applications/author");
    const authorManifest = moduleManifestSchema.parse(JSON.parse(Buffer.from(authorFiles.find(file => file.path === "module.json")!.bytes).toString("utf8")));
    expect(authorManifest.uses).toEqual(["modules.source", "modules.submit", "modules.receipt"]);
    expect(authorManifest.model).toBeUndefined();
    const author = await db.module.create({ data: { workspaceId, name: "author", builtin: false, status: "active", dataSchema: authorManifest.data.schema } });
    const revision = await commitModuleSource({ platform, moduleId: author.id, versionId: `fixture-${author.id}`, files: authorFiles, message: "Approved isolated Author fixture" });
    await checkoutModule(platform, `store/${revision.commit}`, authorFiles);
    await db.moduleVersion.create({ data: { moduleId: author.id, hash: revision.commit, manifest: authorManifest, source: "user", status: "approved", intent: {}, report: { git: revision } } });
    await db.module.update({ where: { id: author.id }, data: { activeHash: revision.commit } });
    const call = async (target: string, raw: Record<string, unknown>) => { const { requestKey, ...args } = raw; return (await callSync(ports, { workspaceId, caller: { kind: "owner", via: null }, chain: [], path: [] }, target, args, { key: requestKey as string | undefined ?? crypto.randomUUID() })).output; };
    const directory = (await call("modules.list", {}) as { items: { id: string; name: string; activeHash: string }[] }).items;
    const discovered = directory.find(item => item.name === "author")!;
    expect(discovered).toMatchObject({ id: author.id, activeHash: revision.commit, builtin: false, status: "active" });
    const submitter = { moduleId: discovered.id, hash: discovered.activeHash };
    const admit = async (requestKey: string, moduleId: string | null, expectedActiveHash: string | null) => await call("modules.admit", { requestKey, submitter, targets: [{ name: "desktop-lifecycle", moduleId, expectedActiveHash }] }) as { admissionId: string };
    const submit = async (admissionId: string, requestKey: string, dir: string) => {
      const receipt = candidateReceiptSchema.parse(await call("author.submit", input({ admissionId, requestKey, items: [{ name: "desktop-lifecycle", dir, intent }] })));
      expect(receipt).toMatchObject({ submitter, state: "submitted", approvalId: null, members: [{ status: "building", selected: false }] });
      expect((await db!.candidateReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId }, include: { admission: true } })).admission.submitterModuleId).toBe(author.id);
      await createModules(ports, workspaceId).buildPending(ports.now());
      const member = receipt.members[0]!;
      const checked = await db!.moduleVersion.findUniqueOrThrow({ where: { id: member.versionId } });
      const report = checked.report as BuildReport;
      expect({ status: checked.status, errors: report.errors, typecheck: report.typecheck }).toEqual({ status: "approved", errors: undefined, typecheck: { status: "passed" } });
      expect(report.tests).toEqual([{ exitCode: 0, stderr: "", stdout: "checked real SDK status without opening a window\n" }]);
      expect(report.git?.commit).toBe(member.hash);
      expect(await call("author.receipt", input({ receiptId: receipt.receiptId }))).toMatchObject({ state: "approved", members: [{ hash: member.hash, status: "approved", selected: true }] });
      expect(await db!.module.findUniqueOrThrow({ where: { id: member.moduleId } })).toMatchObject({ builtin: false, status: "active", activeHash: member.hash });
      return member;
    };
    const initial = await admit("desktop-install", null, null);
    for (const [path, content] of Object.entries(applicationFiles())) await call("author.write", { path: `sources/one/${path}`, content });
    const first = await submit(initial.admissionId, "desktop-submit-one", "sources/one");
    const dataDir = join(platform, "data", first.moduleId);
    const runtimeHandle = (hash: string) => {
      const found = handles.filter(handle => handle.dataDir === dataDir && handle.codeDir === join(platform, "store", hash));
      expect(found).toHaveLength(1);
      return found[0]!.process;
    };
    const opened = await call("desktop-lifecycle.open", {}) as Status;
    expect(opened).toMatchObject({ version: "one", opens: 1 });
    expect(typeof opened.childPid).toBe("number");
    process.kill(opened.pid, 0); process.kill(opened.childPid!, 0);
    expect(await call("desktop-lifecycle.status", {})).toEqual(opened);
    const firstProcess = runtimeHandle(first.hash);

    const update = await admit("desktop-update", first.moduleId, first.hash);
    expect(await call("author.source", input({ admissionId: update.admissionId, moduleId: first.moduleId, hash: first.hash, to: "sources/two" }))).toMatchObject({ moduleId: first.moduleId, hash: first.hash });
    await call("author.write", { path: "sources/two/version.ts", content: 'export const version = "two";\n' });
    const second = await submit(update.admissionId, "desktop-submit-two", "sources/two");
    expect(second).toMatchObject({ moduleId: first.moduleId, expectedActiveHash: first.hash });
    expect(second.hash).not.toBe(first.hash);
    // Wait for the lifecycle operation's own retirement, without manually stopping the instance.
    await bounded(firstProcess.exited, "update retirement");
    expect(await firstProcess.stopEvidence).toMatchObject({ state: "stopped", scope: "descendants", treeClean: true });
    expect(() => process.kill(opened.pid, 0)).toThrow();
    expect(() => process.kill(opened.childPid!, 0)).toThrow();
    await supervisor.reconcile();
    const updated = await call("desktop-lifecycle.status", {}) as Status;
    expect(updated).toMatchObject({ version: "two", childPid: null, opens: 1 });
    expect(updated.pid).not.toBe(opened.pid);
    const reopened = await call("desktop-lifecycle.open", {}) as Status;
    expect(reopened).toMatchObject({ version: "two", pid: updated.pid, opens: 2 });
    expect(typeof reopened.childPid).toBe("number");
    process.kill(reopened.childPid!, 0);
    const secondProcess = runtimeHandle(second.hash);

    expect(await call("modules.disable", { moduleId: first.moduleId, reason: "Close ordinary desktop app" })).toMatchObject({ status: "done", result: { status: "paused" } });
    await bounded(secondProcess.exited, "disable retirement");
    expect(await secondProcess.stopEvidence).toMatchObject({ state: "stopped", scope: "descendants", treeClean: true });
    expect(() => process.kill(reopened.pid, 0)).toThrow();
    expect(() => process.kill(reopened.childPid!, 0)).toThrow();
    expect(await db.module.findUniqueOrThrow({ where: { id: first.moduleId } })).toMatchObject({ builtin: false, status: "paused", activeHash: second.hash });
    expect(await db.audit.findFirstOrThrow({ where: { subjectId: first.moduleId, kind: "module_disabled" } })).toMatchObject({ actorKey: "user", details: { source: "owner" } });
    await supervisor.reconcile();
    await expect(call("desktop-lifecycle.open", {})).rejects.toMatchObject({ code: "unavailable" });
    runtimeHandle(second.hash); // Rejected calls and reconciliation must not respawn the disabled app.
    expect(await readFile(join(dataDir, "opens.json"), "utf8")).toBe("2");
    expect(await db.approval.count()).toBe(0);
  } finally {
    try { await stopSupervisor?.(); }
    finally {
      try {
        for (const handle of handles) handle.process.kill();
        await Promise.all(handles.map(handle => handle.process.exited));
      } finally {
        await db?.$disconnect(); await importedDatabase?.$disconnect();
        if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
        await rm(root, { recursive: true, force: true });
      }
    }
  }
}, 60_000);

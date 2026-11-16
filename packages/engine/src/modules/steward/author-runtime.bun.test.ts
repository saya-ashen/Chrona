import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createServerApp } from "../../../../../apps/server/src/app";
import { createStewardRuntime } from "../../../../../apps/server/src/steward-runtime";
import { createScriptSandbox } from "../../../../integrations/src/steward/runtime/script-sandbox";
import { testDb } from "./test-db";

/** Real Hono/native-tool auth, router, supervisor, SDK and private content; only the Run is fake. */
async function fixture() {
  const db = testDb({ injectedAgent: false });
  const databases = await db.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const database = databases.find(item => item.name === "main")?.file;
  if (!database || basename(database) !== "test.db" || !resolve(database).startsWith(join(resolve(tmpdir()), "chrona-steward-test-"))) {
    await db.$disconnect();
    throw new Error("Author regression requires its own OS-temp test.db");
  }
  const root = await mkdtemp(join(tmpdir(), "chrona-author-runtime-"));
  const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir: root });
  const runtime = createStewardRuntime(db, { provider: null, dataDir: root, sandbox: { ...sandbox.health, startModule: sandbox.startModule } });
  async function close() {
    try { await runtime.stop(); } finally {
      await db.$disconnect();
      await rm(root, { recursive: true, force: true });
      await rm(dirname(database!), { recursive: true, force: true });
    }
  }
  try {
    const workspaceId = (await db.workspace.create({ data: { name: "Offline Author runtime" } })).id;
    const hash = "a".repeat(64), code = join(root, "platform/store", hash);
    await cp(join(import.meta.dir, "applications/author"), code, { recursive: true });
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(join(code, "module.json"), "utf8")));
    const author = await db.module.create({ data: { workspaceId, name: "author", activeHash: hash, status: "active" } });
    await db.moduleVersion.create({ data: { moduleId: author.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
    // An ordinary caller has only the selected file tools; it never acquires owner authority.
    const targets = ["author.list", "author.read", "author.write"];
    const entry = await db.module.create({ data: { workspaceId, name: "author-file-client", activeHash: "v1", status: "active" } });
    await db.moduleVersion.create({ data: { moduleId: entry.id, hash: "v1", manifest: moduleManifestSchema.parse({ name: entry.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, uses: targets }), source: "user", status: "approved", intent: {}, report: {} } });
    const session = await db.session.create({ data: { workspaceId, source: "module", moduleId: entry.id, key: "author-offline" } });
    await db.agentContext.create({ data: { sessionId: session.id, workspaceId, moduleId: entry.id, hash: "v1" } });
    const token = "author-offline-run", expires = new Date(Date.now() + 120_000);
    const run = await db.run.create({ data: { workspaceId, sessionId: session.id, lane: "foreground", trigger: "message", status: "running", provider: "offline-fixture", tokenHash: createHash("sha256").update(token).digest("hex"), cwd: root, prompt: "No model execution", deadlineAt: expires, leaseUntil: expires } });
    await db.agentRunAdmission.create({ data: { runId: run.id, moduleId: entry.id, hash: (await db.agentContext.findUniqueOrThrow({ where: { sessionId: (await db.run.findUniqueOrThrow({ where: { id: run.id } })).sessionId! } })).hash, targets: targets.map(target => ({ target, moduleId: author.id })), content: [] } });
    const app = await createServerApp({ steward: runtime });
    const request = async (tool: string, args: unknown, capability = token) => {
      const started = performance.now();
      const response = await app.request(`/api/steward-agent/tools/m_author_${tool}`, {
        method: "POST", headers: { authorization: `Bearer ${capability}`, "content-type": "application/json" }, body: JSON.stringify(args),
      }, { server: { requestIP: () => ({ address: "127.0.0.1" }) } });
      expect(performance.now() - started, `author.${tool} must answer promptly`).toBeLessThan(2000);
      return response;
    };
    return { db, author, entry, run, request, content: join(root, "platform/content", author.id), root, close };
  } catch (error) { await close(); throw error; }
}

async function failure(response: Response, code: string) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(409);
  expect(body).toMatchObject({ ok: false, error: { code } });
  return body;
}
async function success(response: Response, result: unknown) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body).toEqual({ ok: true, data: { result } });
}

test("fresh Author returns bounded missing-source errors through the production native SDK route", async () => {
  const f = await fixture();
  try {
    expect((await f.request("list", { path: "sources" }, "wrong-token")).status).toBe(401);
    // Before the fix source_io was rejected by the event-reply schema and became Module event timeout.
    await failure(await f.request("list", { path: "sources" }), "not_found");
    expect(await readdir(f.content)).toEqual([]);
    await success(await f.request("list", { path: "" }), { path: "", entries: [] });
    await success(await f.request("list", { path: "." }), { path: "", entries: [] });
    await failure(await f.request("list", { path: "packages" }), "not_found");
    await failure(await f.request("read", { path: "sources/missing/index.ts" }), "not_found");
    await failure(await f.request("list", { path: "../outside" }), "invalid");
    await failure(await f.request("read", { path: "" }), "invalid");
    await failure(await f.request("write", { path: "", content: "no" }), "invalid");
    await failure(await f.request("prepare", {}), "forbidden");
    await success(await f.request("write", { path: "sources/work/index.ts", content: "explicit offline material" }), { path: "sources/work/index.ts", size: 25 });
    await success(await f.request("list", { path: "sources/work" }), { path: "sources/work", entries: [{ name: "index.ts", kind: "file" }] });
    // ENOTDIR remains a sanitized failure; source_io must never cross the SDK wire.
    const ioFailure = await failure(await f.request("read", { path: "sources/work/index.ts/child" }), "failed");
    expect(JSON.stringify(ioFailure)).not.toContain(f.root);
    // Root only reveals the two public namespaces, never other private content.
    await writeFile(join(f.content, "private-state.json"), "private");
    await success(await f.request("list", { path: "" }), { path: "", entries: [{ name: "sources", kind: "directory" }] });
    await symlink(f.root, join(f.content, "sources/work/escape"));
    await failure(await f.request("list", { path: "sources/work" }), "invalid");
    await symlink(f.root, join(f.content, "packages"));
    await failure(await f.request("list", { path: "" }), "invalid");
    const invocations = await f.db.moduleInvocation.findMany({ where: { target: "author" } });
    expect(invocations.length).toBeGreaterThan(0);
    expect(invocations.every(row => row.callerModuleId === f.entry.id)).toBe(true);
    expect(invocations.some(row => row.error?.includes("Module event timeout"))).toBe(false);
    expect(await f.db.run.count()).toBe(1);
    expect((await f.db.run.findUniqueOrThrow({ where: { id: f.run.id } })).status).toBe("running");
    await f.db.run.update({ where: { id: f.run.id }, data: { status: "finished" } });
  } finally { await f.close(); }
}, 20_000);

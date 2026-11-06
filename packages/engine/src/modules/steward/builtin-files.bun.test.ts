import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_MODULE_NAMES } from "@chrona/contracts/steward";
import { seedTestModuleRelease, testReleasePackages } from "./module-release-test-fixture";
import { createFiles } from "./builtin/files/files";
import { registerBuiltins } from "./module-builtin";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { createStewardService } from "./service";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";

const shippedResources = fileURLToPath(new URL("./builtin", import.meta.url));
const now = new Date("2026-10-22T00:00:00Z");

async function fixture(real = false) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-files-engine-");
  const resources = join(dataDir, "resources", "builtin");
  await cp(shippedResources, resources, { recursive: true });
  for (const name of BUILTIN_MODULE_NAMES) await seedTestModuleRelease(resources, name);
  const workspaceId = (await db.workspace.create({ data: { name: "files" } })).id;
  const peer = testModuleProcess(async (event, _call, input) => {
    const app = createFiles(input.contentDir!, input.dataDir);
    if (event.trigger.kind === "tool") return { result: await app.tool(event.trigger.id, event.trigger.args, event.now) };
    throw new Error("Unexpected event");
  });
  const sandbox = real ? createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined, dataDir }) : null;
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, moduleBuiltinResources: resources, packages: testReleasePackages(resources),
    // Without bwrap, author tests run as plain processes exactly as on a host without a sandbox.
    sandbox: { available: sandbox?.health.available ?? true, isolated: sandbox?.health.isolated ?? true, runModule: (sandbox ?? createScriptSandbox({ dataDir })).runModule, startModule: sandbox?.startModule ?? peer.startModule } };
  const api = createStewardService(ports).forWorkspace(workspaceId);
  return { db, ports, workspaceId, api,
    async start() {
      await registerBuiltins(ports, workspaceId);
      return db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId, name: "files" } } });
    },
    call: async (tool: string, args: Record<string, unknown> = {}) => (await api.modules.callTool(`m_files_${tool}`, args)).result as any,
    async close() { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); },
  };
}

test("files fresh workspace: trusted release activation, owner tools, history and trash", async () => {
  const f = await fixture();
  try {
    const app = await f.start();
    expect(app).toMatchObject({ builtin: true, status: "active" });
    expect(await f.db.approval.count()).toBe(0);
    const version = await f.db.moduleVersion.findFirstOrThrow();
    expect(version.report).toMatchObject({ tests: [], errors: [] });
    expect(app.activeHash).toBeTruthy();
    expect((await f.api.modules.tools()).tools.map(tool => tool.name).filter(name => name.startsWith("m_files_"))).toEqual(["list", "read", "write", "move", "delete", "history", "restore"].map(name => `m_files_${name}`));
    expect(await f.call("write", { path: "report.txt", content: "one" })).toEqual({ ok: true });
    await f.call("write", { path: "report.txt", content: "two" });
    const history = await f.call("history", { path: "report.txt" });
    expect(history.versions).toHaveLength(2);
    await f.call("restore", { path: "report.txt", version: history.versions[0].version });
    expect(await f.call("read", { path: "report.txt" })).toMatchObject({ content: "one" });
    await f.call("move", { from: "report.txt", to: "reports/final.txt" });
    const deleted = await f.call("delete", { path: "reports" });
    expect(deleted.path).toStartWith(".trash/");
    expect(await f.call("read", { path: deleted.path + "/final.txt" })).toMatchObject({ content: "one" });
    expect(await f.db.audit.findFirst({ where: { kind: "module_tool_call" } })).toMatchObject({ actorKey: "user" });
    await f.start(); expect(await f.db.moduleVersion.count({ where: { moduleId: app.id } })).toBe(1);
  } finally { await f.close(); }
}, 30_000);

test("files rejects unsafe paths, links, oversized output; caps persisted versions and restores after restart", async () => {
  const root = await mkdtemp("/tmp/chrona-files-unit-");
  const content = join(root, "content"), data = join(root, "data");
  await mkdir(content); await mkdir(data);
  try {
    const app = createFiles(content, data);
    for (const path of ["..", "../escape", "/etc/passwd", ".git/config", "a/../../b", "a/.git/x", "a\\b", "a//b", "a/./b"]) {
      expect(await app.tool("write", { path, content: "no" }, now.toISOString())).toHaveProperty("error");
    }
    await symlink(data, join(content, "link"));
    expect(await app.tool("write", { path: "link/escape", content: "no" }, now.toISOString())).toHaveProperty("error");
    for (let i = 0; i < 25; i++) await app.tool("write", { path: "a.txt", content: String(i) }, now.toISOString());
    const history = await app.tool("history", { path: "a.txt" }, now.toISOString()) as { versions: { version: string }[] };
    expect(history.versions).toHaveLength(20);
    const entries = await readdir(join(data, "history", (await readdir(join(data, "history")))[0]!));
    expect(entries).toHaveLength(21);
    const restarted = createFiles(content, data);
    await restarted.tool("restore", { path: "a.txt", version: history.versions[0]!.version }, now.toISOString());
    expect(await restarted.tool("read", { path: "a.txt" }, now.toISOString())).toMatchObject({ content: "5" });
    await writeFile(join(content, "large.txt"), '😀"\\\n'.repeat(20_000));
    const result = await app.tool("read", { path: "large.txt" }, now.toISOString());
    expect(result).toMatchObject({ truncated: true, content: expect.stringContaining("[truncated]") });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(16_384);
    await writeFile(join(content, "binary.png"), Buffer.from([137, 80, 78, 71, 0, 255]));
    expect(await app.tool("read", { path: "binary.png" }, now.toISOString())).toEqual({ size: 6, mime: "image/png" });
    for (let byte = 0; byte <= 32; byte++) {
      await writeFile(join(content, "control.txt"), `before${String.fromCharCode(byte)}after`);
      const read = await app.tool("read", { path: "control.txt" }, now.toISOString());
      expect(typeof read === "object" && read !== null && "content" in read).toBe((byte >= 9 && byte <= 13) || byte === 32);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

const realSandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
if (!realSandbox.health.available) console.info("SKIP files real process: module runtime unavailable");
(realSandbox.health.available ? test : test.skip)("files real SDK process registers and reads/writes content", async () => {
  const f = await fixture(true);
  try {
    const app = await f.start();
    const version = await f.db.moduleVersion.findFirstOrThrow();
    expect(version.report).toMatchObject({ tests: [], errors: [] });
    const sandbox = createScriptSandbox({ dataDir: f.ports.dataDir });
    await mkdir(join(f.ports.dataDir, "platform/data", app.id), { recursive: true });
    await mkdir(join(f.ports.dataDir, "platform/content", app.id), { recursive: true });
    const author = await sandbox.runModule({ codeDir: join(f.ports.moduleBuiltinResources!, "files"), dataDir: join(f.ports.dataDir, "platform/data", app.id), contentDir: join(f.ports.dataDir, "platform/content", app.id), entry: "test.ts", input: {} });
    expect(author).toMatchObject({ status: "succeeded", exitCode: 0 });
    expect(app.activeHash).toBeTruthy();
    expect(await f.call("write", { path: "real.txt", content: "sandbox" })).toEqual({ ok: true });
    expect(await f.call("read", { path: "real.txt" })).toMatchObject({ content: "sandbox" });
  } finally { await f.close(); }
}, 30_000);

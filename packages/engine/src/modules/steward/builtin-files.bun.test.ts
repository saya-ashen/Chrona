import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFiles } from "./builtin/files/files";
import { registerBuiltins } from "./module-builtin";
import { moduleSupervisor } from "./module-supervisor";
import { testModuleProcess } from "./module-test-process";
import { createStewardService } from "./service";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { createScriptSandbox } from "../../../../integrations/src/steward/script-sandbox";
import { createLocalTestSource } from "../../../../integrations/src/steward/local-test-source";

const resources = fileURLToPath(new URL("./builtin", import.meta.url));
const sdk = fileURLToPath(new URL("../../../../integrations/src/steward/module-sdk", import.meta.url));
const now = new Date("2026-10-22T00:00:00Z");

/** Test-only host runner: rewrites sandbox mounts to disposable paths. Never used by production. */
async function authorTests(input: Parameters<NonNullable<NonNullable<StewardPorts["sandbox"]>["runModule"]>>[0]) {
  const root = await mkdtemp("/tmp/chrona-files-author-");
  try {
    const code = join(root, "module"), content = input.contentDir!;
    await mkdir(code);
    for (const name of await readdir(input.codeDir)) {
      let text = await readFile(join(input.codeDir, name), "utf8");
      if (name.endsWith(".ts")) text = text.replaceAll("/module/", code + "/").replaceAll("/chrona/sdk.ts", join(code, "sdk.ts")).replaceAll("/chrona/testing.ts", join(code, "testing.ts")).replaceAll("/content", content).replaceAll('"/data"', JSON.stringify(input.dataDir));
      await writeFile(join(code, name), text);
    }
    await writeFile(join(code, "sdk.ts"), await readFile(join(sdk, "sdk.ts")));
    await writeFile(join(code, "testing.ts"), (await readFile(join(sdk, "testing.ts"), "utf8")).replaceAll("/module/module.json", join(code, "module.json")));
    const child = Bun.spawn([process.execPath, join(code, input.entry)], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH } });
    const [output, error, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { status: exitCode === 0 ? "succeeded" as const : "failed" as const, exitCode, output, error: error || null };
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function fixture(real = false) {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-files-engine-");
  const workspaceId = (await db.workspace.create({ data: { name: "files" } })).id;
  const local = createLocalTestSource();
  const peer = testModuleProcess(async (event, _call, input) => {
    const app = createFiles(input.contentDir, input.dataDir);
    if (event.trigger.kind === "content_edit") { await app.contentEdit(event.trigger.paths, event.now); return {}; }
    if (event.trigger.kind === "tool") return { result: await app.tool(event.trigger.id, event.trigger.args, event.now) };
    throw new Error("Unexpected event");
  });
  const sandbox = real ? createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined }) : null;
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, chat: null, deliveries: [], connectors: [local.adapter], moduleBuiltinResources: resources,
    sandbox: { available: true, runModule: sandbox?.runModule ?? authorTests, startModule: sandbox?.startModule ?? peer.startModule } };
  const api = createStewardService(ports).forWorkspace(workspaceId);
  return { db, ports, workspaceId, api, local,
    async start() {
      await registerBuiltins(ports, workspaceId);
      return db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId, name: "files" } } });
    },
    call: async (tool: string, args: Record<string, unknown> = {}) => (await api.modules.callTool(`m_files_${tool}`, args)).result as any,
    async close() { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); },
  };
}

test("files fresh workspace: author SDK tests, automatic activation, owner tools, history, trash and connector intake", async () => {
  const f = await fixture();
  try {
    const app = await f.start();
    expect(app).toMatchObject({ builtin: true, status: "active" });
    expect(await f.db.approval.count()).toBe(0);
    const version = await f.db.moduleVersion.findFirstOrThrow();
    expect(version.report).toMatchObject({ tests: [{ exitCode: 0 }] });
    expect(app.activeHash).toBeTruthy();
    expect((await f.api.modules.tools()).tools.map(tool => tool.name)).toEqual(["list", "read", "write", "move", "delete", "history", "restore"].map(name => `m_files_${name}`));
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
    await f.api.content.save(app.id, { path: "external.txt", content: "edited", baseRevision: null });
    expect((await f.call("history", { path: "external.txt" })).versions).toHaveLength(1);
    const connector = await f.api.connectors.create({ kind: "local_test", label: "Inbox" });
    f.local.push([{ externalId: "mail-1", from: "sender", subject: "Document", body: "Connector document", receivedAt: now.toISOString(), url: null, attachments: [] }]);
    await f.api.connectors.sync(connector.id);
    const [item] = await f.api.connectors.items(connector.id);
    expect(item!.ref).toStartWith(`inbox/${connector.id}/`);
    expect(await f.call("read", { path: item!.ref })).toMatchObject({ content: expect.stringContaining("Connector document") });
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
  } finally { await rm(root, { recursive: true, force: true }); }
});

const realSandbox = createScriptSandbox({ bwrapPath: Bun.which("bwrap") ?? undefined });
if (!realSandbox.health.available) console.info("SKIP files real process: bwrap sandbox unavailable");
(realSandbox.health.available ? test : test.skip)("files real bwrap SDK process registers and reads/writes content", async () => {
  const f = await fixture(true);
  try {
    const app = await f.start();
    const version = await f.db.moduleVersion.findFirstOrThrow();
    expect(version.report).toMatchObject({ tests: [{ exitCode: 0 }] });
    expect(app.activeHash).toBeTruthy();
    expect(await f.call("write", { path: "real.txt", content: "sandbox" })).toEqual({ ok: true });
    expect(await f.call("read", { path: "real.txt" })).toMatchObject({ content: "sandbox" });
  } finally { await f.close(); }
}, 30_000);

import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StewardPorts } from "./ports";
import { contentArea, filesContent, createContent, deliverContentEdit } from "./content";
import { testModuleProcess } from "./module-test-process";
import { moduleSupervisor } from "./module-supervisor";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(content = true) {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-content-")); roots.push(dataDir);
  const module = { id: "module-id", name: "notes", activeHash: "hash" };
  return { dataDir, db: {
    module: { findFirst: async ({ where }: { where: { workspaceId: string; status?: string } }) => where.workspaceId === "workspace" && !where.status ? module : null, findUnique: async () => null },
    moduleVersion: { findUnique: async () => ({ manifest: { name: "notes", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], content } }) },
  } } as unknown as StewardPorts;
}
test("content revisions are hashes and stale saves cannot overwrite edits", async () => {
  const files = await contentArea(await fixture(), "workspace", "module-id");
  const saved = await files.save("README.md", "First", null);
  expect(saved.revision).toHaveLength(64);
  expect((await files.read("README.md")).revision).toBe(saved.revision);
  await expect(files.save("README.md", "Stale", null)).rejects.toMatchObject({ code: "conflict" });
  await files.save("README.md", "Second", saved.revision);
  expect((await files.read("README.md")).content).toBe("Second");
  expect((await files.list()).map(file => file.path)).toEqual(["README.md"]);
});
test("content requires a declaring manifest and workspace ownership; missing files is not_found", async () => {
  await expect(contentArea(await fixture(false), "workspace", "module-id")).rejects.toMatchObject({ code: "not_found" });
  await expect(contentArea(await fixture(), "foreign", "module-id")).rejects.toMatchObject({ code: "not_found" });
  await expect(filesContent(await fixture(), "workspace")).rejects.toMatchObject({ code: "not_found" });
});
test("owner writes and provider edit batches reach content modules without a declared trigger", async () => {
  const ports = await fixture(), events: unknown[] = [];
  const module = { id: "module-id", workspaceId: "workspace", name: "notes", activeHash: "hash", status: "active" };
  const peer = testModuleProcess(async event => { events.push(event.trigger); return {}; });
  const db = ports.db as unknown as { module: unknown; moduleRun: unknown };
  db.module = { findFirst: async () => module, findUnique: async () => module, findUniqueOrThrow: async () => module };
  const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: "hash" } } });
  Object.assign(ports.db.moduleVersion, { findUniqueOrThrow: async () => version });
  db.moduleRun = { create: async () => ({ id: "run" }), update: async () => ({}) };
  ports.now = () => new Date("2026-10-22T04:00:00Z");
  ports.sandbox = { available: true, isolated: true, startModule: peer.startModule };
  try {
    const api = createContent(ports, "workspace", async () => {});
    await api.save(module.id, { path: "README.md", content: "Notes", baseRevision: null });
    await deliverContentEdit(ports, "workspace", module.id, ["report.md", "deleted.md"], "provider");
    expect(events).toEqual([
      { kind: "content_edit", id: "content", firedAt: ports.now().toISOString(), paths: ["README.md"], by: "user" },
      { kind: "content_edit", id: "content", firedAt: ports.now().toISOString(), paths: ["report.md", "deleted.md"], by: "provider" },
    ]);
  } finally { await moduleSupervisor(ports).stop(); }
});
test("owner checkbox uses the supplied revision and preserves markdown", async () => {
  const ports = await fixture(), api = createContent(ports, "workspace", async () => {});
  const saved = await api.save("module-id", { path: "README.md", content: "# Tasks\n- [ ] First\n", baseRevision: null });
  const toggled = await api.toggleCheckbox("module-id", { path: "README.md", line: 2, checked: true, baseRevision: saved.revision });
  expect(toggled.content).toBe("# Tasks\n- [x] First\n");
  await expect(api.toggleCheckbox("module-id", { path: "README.md", line: 2, checked: false, baseRevision: saved.revision })).rejects.toMatchObject({ code: "conflict" });
});
test("owner uploads cannot overwrite existing files or write executables", async () => {
  const ports = await fixture(), api = createContent(ports, "workspace", async () => {});
  expect(await api.upload("module-id", "uploads", "report.txt", Buffer.from("Report"))).toMatchObject({ path: "uploads/report.txt", size: 6 });
  await expect(api.upload("module-id", "uploads", "report.txt", Buffer.from("Other"))).rejects.toHaveProperty("code");
  await expect(api.upload("module-id", "", "run.sh", Buffer.from("echo hi"))).rejects.toMatchObject({ code: "invalid" });
  expect((await api.read("module-id", "uploads/report.txt")).content).toBe("Report");
});
test("owner panels append only data declared in a page", async () => {
  const ports = await fixture(), api = createContent(ports, "workspace", async () => {});
  const panel = { title: "Weight", data: "weight.csv", fields: [{ key: "weight", label: "Weight", type: "number", required: true }], views: [{ kind: "table", columns: ["weight"] }] };
  await api.save("module-id", { path: "README.md", content: "```chrona-panel\n" + JSON.stringify(panel) + "\n```", baseRevision: null });
  expect((await api.appendPanelEntry("module-id", { dataPath: "weight.csv", values: { weight: 60 } })).content).toBe("weight\n60\n");
  await expect(api.appendPanelEntry("module-id", { dataPath: "other.csv", values: {} })).rejects.toMatchObject({ code: "invalid" });
});
for (const path of ["../escape.md", "index.ts", "nested/run.sh", "script.py"]) test(`content rejects ${path}`, async () => {
  const files = await contentArea(await fixture(), "workspace", "module-id");
  await expect(files.intake([{ path, bytes: Buffer.from("content") }])).rejects.toHaveProperty("code");
});

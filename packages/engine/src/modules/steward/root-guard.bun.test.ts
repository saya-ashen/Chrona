import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "./test-db";
import { createStewardService, type StewardPorts } from "./service";
import { guardWorkspaceRoot } from "./root-guard";

async function fixture() {
  const db = testDb();
  const workspaceId = (await db.workspace.create({ data: { name: "root" } })).id;
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-root-guard-"));
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), deliveries: [], chat: null, publicUrl: null };
  return { db, workspaceId, ports, service: createStewardService(ports), root: join(dataDir, "affairs") };
}

test.each(["finished", "failed", "timed_out", "rejected", "throws"])("root cleanup precedes finalization after %s", async outcome => {
  const f = await fixture();
  try {
    const owner = f.service.forWorkspace(f.workspaceId);
    const affair = await owner.affairs.create({ title: "Existing work" });
    const row = await f.db.affair.findUniqueOrThrow({ where: { id: affair.id } });
    await writeFile(join(f.root, "existing.txt"), "preserve");
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    f.ports.provider = { name: "fake", health: async () => ({ available: true, sandboxed: false, error: null }), start(input) {
      expect(input.prompt).toContain("root is NOT an affair");
      expect(input.prompt).toContain(row.dirName);
      expect(input.prompt).toContain("Existing work");
      if (outcome === "throws") throw new Error("start failure");
      return { inject: async () => {}, abort: async () => {}, done: (async () => {
        await writeFile(join(input.cwd, "README.md"), "stray work");
        await writeFile(join(input.cwd, row.dirName, "notes.md"), "affair work");
        await wait;
        if (outcome === "rejected") throw new Error("fake rejection");
        return { outcome: outcome as "finished" | "failed" | "timed_out", sessionId: null, error: null };
      })() };
    } };
    const run = await owner.runs.enqueue({ lane: "foreground", trigger: "message", prompt: "work" });
    await f.service.tick();
    release();
    let status = "running";
    for (let i = 0; i < 100 && status === "running"; i++) {
      await Bun.sleep(10);
      status = (await f.db.run.findUniqueOrThrow({ where: { id: run.id } })).status;
    }
    expect(status).not.toBe("running");
    expect(await readFile(join(f.root, "existing.txt"), "utf8")).toBe("preserve");
    if (outcome !== "throws") {
      expect(await readFile(join(f.root, ".chrona/stray", run.id, "README.md"), "utf8")).toBe("stray work");
      expect(await readdir(f.root)).not.toContain("README.md");
      expect(await readFile(join(f.root, row.dirName, "notes.md"), "utf8")).toBe("affair work");
      expect(await f.db.audit.findFirst({ where: { kind: "workspace_stray_quarantined", subjectId: run.id } })).toMatchObject({ details: { path: "README.md", destination: `.chrona/stray/${run.id}/README.md` } });
    }
  } finally { await f.db.$disconnect(); }
});

test("quarantine moves links without following them and preserves new affair directories", async () => {
  const f = await fixture();
  try {
    await mkdir(f.root);
    const cleanup = await guardWorkspaceRoot(f.ports, f.workspaceId, "run", f.root);
    const outside = join(f.ports.dataDir, "outside.txt");
    await writeFile(outside, "untouched");
    await symlink(outside, join(f.root, "link"));
    await mkdir(join(f.root, "new-affair"));
    await cleanup();
    expect(await readlink(join(f.root, ".chrona/stray/run/link"))).toBe(outside);
    expect(await readFile(outside, "utf8")).toBe("untouched");
    expect(await readdir(f.root)).toContain("new-affair");
  } finally { await f.db.$disconnect(); }
});

test("quarantine refuses a symlink destination and audits failure without moving files outside", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, ".chrona"), { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), "chrona-stray-outside-"));
    await symlink(outside, join(f.root, ".chrona", "stray"));
    const cleanup = await guardWorkspaceRoot(f.ports, f.workspaceId, "run", f.root);
    await writeFile(join(f.root, "stray.txt"), "preserve on failure");
    await expect(cleanup()).rejects.toThrow("Unsafe quarantine directory");
    expect(await readFile(join(f.root, "stray.txt"), "utf8")).toBe("preserve on failure");
    expect(await readdir(outside)).toEqual([]);
    expect(await f.db.audit.count({ where: { kind: "workspace_stray_quarantine_failed", subjectId: "run" } })).toBe(1);
  } finally { await f.db.$disconnect(); }
});

test("tool paths are relative to affair cwd, including sibling and same-affair focus", async () => {
  const f = await fixture();
  try {
    const owner = f.service.forWorkspace(f.workspaceId);
    const a = await owner.affairs.create({ title: "First" });
    await owner.runs.enqueue({ affairId: a.id, lane: "foreground", trigger: "message", prompt: "work", conversationKey: "conversation" });
    const run = (await owner.runs.claimNext("foreground"))!;
    const b = await f.service.tools.call(run.token, "chrona_affair_create", { title: "Second" }) as { id: string; path: string };
    const row = await f.db.affair.findUniqueOrThrow({ where: { id: b.id } });
    expect(b.path).toBe(`../${row.dirName}`);
    expect(await f.service.tools.call(run.token, "chrona_focus", { affairId: b.id })).toEqual({ affairId: b.id, path: b.path });
    expect(await f.service.tools.call(run.token, "chrona_focus", { affairId: a.id })).toEqual({ affairId: a.id, path: "." });
  } finally { await f.db.$disconnect(); }
});

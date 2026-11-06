import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";
import { moduleContext } from "./module-context";
import { propose } from "./module-proposal";
import { moduleUpstream, recordModuleUpstream, submitMergedCommit } from "./module-upstream";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { getModuleLocalHead, moduleGitCommand, moduleGitPath } from "./module-git";
import { importModuleGitBundle } from "./module-git-upstream";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-upstream-route-test-")), db = testDb();
  cleanups.push(async () => { await db.$disconnect(); await rm(root, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "Upstream fixture" } });
  const resources = join(root, "external"), dir = join(resources, "remind"); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "module.json"), JSON.stringify(moduleManifestSchema.parse({ name: "remind", entry: "index.ts", keepAlive: true, triggers: [], effects: [], tests: ["test.ts"] })));
  await writeFile(join(dir, "index.ts"), "// original\n"); await writeFile(join(dir, "test.ts"), "// test\n");
  const git = await seedTestModuleRelease(resources, "remind");
  const ports: StewardPorts = { db, dataDir: root, now: () => new Date(), publicUrl: null }, context = moduleContext(ports, workspace.id);
  const proposal = await propose(context, { root: resources, dir: "remind", intent: { changes: ["Initial checked candidate"] }, sourceCommit: git.commit, gitBundle: git }, "user");
  const moduleId = proposal.moduleId!;
  await db.moduleVersion.update({ where: { moduleId_hash: { moduleId, hash: proposal.hash } }, data: { status: "approved" } });
  await db.module.update({ where: { id: moduleId }, data: { activeHash: proposal.hash } });
  await recordModuleUpstream(ports, workspace.id, moduleId, git);
  const location = { platform: context.platform, moduleId };
  async function update() {
    await writeFile(join(dir, "upstream.txt"), "official update\n");
    return seedTestModuleRelease(resources, "remind");
  }
  return { root, resources, dir, ports, context, workspaceId: workspace.id, moduleId, git, location, update };
}
test("offline module status is honest and fetch cannot invent a remote", async () => {
  const f = await fixture();
  expect(await moduleUpstream(f.ports, f.workspaceId, { action: "status", moduleId: f.moduleId })).toMatchObject({ repository: null, localCommit: f.git.commit, fetchedCommit: null, proposal: null });
  await expect(moduleUpstream(f.ports, f.workspaceId, { action: "fetch", moduleId: f.moduleId })).rejects.toThrow("not configured");
  expect(await getModuleLocalHead(f.location)).toBe(f.git.commit);
  await expect(moduleUpstream(f.ports, "other-workspace", { action: "status", moduleId: f.moduleId })).rejects.toMatchObject({ code: "not_found" });
});
test("offline bundle merge queues preserved local changes without activating", async () => {
  const f = await fixture();
  await writeFile(join(f.dir, "local.txt"), "local customization\n");
  const local = await propose(f.context, { root: f.resources, dir: "remind", intent: { changes: ["Local customization"] } }, "user");
  await rm(join(f.dir, "local.txt"));
  const update = await f.update(); let prepared = "";
  const proposal = await submitMergedCommit(f.context, { moduleId: f.moduleId, commit: update.commit, bundle: update, intent: { changes: ["Offline update"], preserves: ["Local customization"] }, onPrepared: async commit => { prepared = commit; } });
  expect(proposal).toMatchObject({ hash: prepared, status: "building" });
  const { readModuleSource } = await import("./module-git");
  expect((await readModuleSource({ ...f.location, commit: proposal.hash })).map(file => file.path)).toContain("local.txt");
  expect((await readModuleSource({ ...f.location, commit: proposal.hash })).map(file => file.path)).toContain("upstream.txt");
  expect(await getModuleLocalHead(f.location)).not.toBe(local.hash);
  expect((await f.ports.db.module.findUniqueOrThrow({ where: { id: f.moduleId } })).activeHash).toBe(f.git.commit);
});
test("explicit fetched merge uses a request key once and rejects stale selections", async () => {
  const f = await fixture(), update = await f.update();
  // Synthetic descriptor only: no network fetch or published repository assertion.
  const repository = "https://github.com/chrona/fixture.git";
  await importModuleGitBundle({ ...f.location, ...update, repository });
  await recordModuleUpstream(f.ports, f.workspaceId, f.moduleId, { ...update, repository });
  const request = { action: "merge" as const, moduleId: f.moduleId, commit: update.commit, baseHash: f.git.commit, requestKey: "merge-once" };
  const result = await moduleUpstream(f.ports, f.workspaceId, request);
  expect(result.proposal?.status).toBe("building");
  expect(await moduleUpstream(f.ports, f.workspaceId, request)).toEqual(result);
  await expect(moduleUpstream(f.ports, f.workspaceId, { ...request, commit: f.git.commit })).rejects.toMatchObject({ code: "conflict" });
  await expect(moduleUpstream(f.ports, f.workspaceId, { ...request, requestKey: "stale", baseHash: "f".repeat(40) })).rejects.toThrow("Active module version changed");
  expect((await f.ports.db.module.findUniqueOrThrow({ where: { id: f.moduleId } })).activeHash).toBe(f.git.commit);
});
test("merge conflict keeps local source and active version; retry does not rerun merge", async () => {
  const f = await fixture();
  await writeFile(join(f.dir, "index.ts"), "// local conflicting edit\n");
  const local = await propose(f.context, { root: f.resources, dir: "remind", intent: { changes: ["Local edit"] } }, "user");
  await writeFile(join(f.dir, "index.ts"), "// upstream conflicting edit\n");
  const update = await seedTestModuleRelease(f.resources, "remind"), repository = "https://github.com/chrona/fixture.git";
  await importModuleGitBundle({ ...f.location, ...update, repository });
  await moduleGitCommand(moduleGitPath(f.context.platform, f.moduleId), ["update-ref", "refs/remotes/upstream/main", update.commit]);
  await recordModuleUpstream(f.ports, f.workspaceId, f.moduleId, { ...update, repository });
  const request = { action: "merge" as const, moduleId: f.moduleId, commit: update.commit, baseHash: f.git.commit, requestKey: "conflict-once" };
  await expect(moduleUpstream(f.ports, f.workspaceId, request)).rejects.toThrow("conflicts");
  await expect(moduleUpstream(f.ports, f.workspaceId, request)).rejects.toThrow("Original upstream merge");
  expect(await getModuleLocalHead(f.location)).toBe(local.hash);
  expect((await f.ports.db.module.findUniqueOrThrow({ where: { id: f.moduleId } })).activeHash).toBe(f.git.commit);
});

test("legacy active module without Git source is not replaced by an update bundle", async () => {
  const f = await fixture(), legacyHash = "a".repeat(64);
  await f.ports.db.module.update({ where: { id: f.moduleId }, data: { activeHash: legacyHash } });
  await rm(moduleGitPath(f.context.platform, f.moduleId), { recursive: true });
  await expect(submitMergedCommit(f.context, { moduleId: f.moduleId, commit: f.git.commit, bundle: f.git, intent: { changes: ["Update legacy"], preserves: [] }, onPrepared: async () => { throw new Error("must not queue"); } })).rejects.toThrow("no local Git source");
  expect(await getModuleLocalHead(f.location)).toBeUndefined();
  expect((await f.ports.db.module.findUniqueOrThrow({ where: { id: f.moduleId } })).activeHash).toBe(legacyHash);
});

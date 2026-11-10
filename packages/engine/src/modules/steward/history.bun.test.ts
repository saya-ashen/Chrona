import { afterEach, beforeEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { listBuildFacts, readBuildFacts, readBuildTranscript } from "./module-build-session";
import type { StewardPorts } from "./ports";

let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string;
beforeEach(async () => {
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "build-facts" } })).id;
  ports = { db, dataDir: "/unused-build-facts", now: () => new Date("2026-11-08T00:00:00Z"), publicUrl: null };
});
afterEach(async () => { await db.$disconnect(); });
async function build(key: string, workspace = workspaceId, source = "build", targets = true) {
  const session = await db.session.create({ data: { workspaceId: workspace, source, key, title: "private title", providerSessionId: "private-provider-continuation" } });
  if (targets) await db.buildTargets.create({ data: { sessionId: session.id, name: "sample", modules: ["sample"] } });
  return session;
}
test("build facts replace legacy reads without exposing entry journals, Agent contexts or foreign builds", async () => {
  const valid = await build("build:valid");
  const legacy = await build("web:legacy", workspaceId, "web");
  const missing = await build("build:missing", workspaceId, "build", false);
  const context = await build("module:context", workspaceId, "module");
  const marked = await build("build:marked");
  for (const session of [context, marked]) await db.agentContext.create({ data: { sessionId: session.id, workspaceId, moduleId: "test", hash: "" } });
  const other = await db.workspace.create({ data: { name: "foreign" } });
  const foreign = await build("build:foreign", other.id);
  expect((await listBuildFacts(ports, workspaceId)).map(row => row.id)).toEqual([valid.id]);
  expect(await readBuildFacts(ports, workspaceId, valid.id)).toMatchObject({ id: valid.id, targets: ["sample"], runs: [], queue: null });
  expect(await readBuildTranscript(ports, workspaceId, valid.id)).toEqual([]);
  for (const session of [legacy, missing, context, marked, foreign]) {
    await expect(readBuildFacts(ports, workspaceId, session.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(readBuildTranscript(ports, workspaceId, session.id)).rejects.toMatchObject({ code: "not_found" });
  }
  expect(await db.run.count()).toBe(0);
});
test("build facts are bounded and contain no Run authority, prompts, host paths or provider continuation", async () => {
  const session = await build("build:runs");
  await db.run.createMany({ data: Array.from({ length: 55 }, (_, index) => ({ workspaceId, sessionId: session.id, lane: "build", trigger: "build", status: "finished", provider: "fixture", tokenHash: `private-token-${index}`, cwd: "/private-host-path", prompt: "private prompt", error: "x".repeat(2000), createdAt: new Date(ports.now().getTime() + index) })) });
  const result = await readBuildFacts(ports, workspaceId, session.id);
  expect(result.runs).toHaveLength(50);
  expect(result.runs.every(run => run.error!.length <= 1000)).toBe(true);
  const text = JSON.stringify(result);
  for (const forbidden of ["private-token", "private-host-path", "private prompt", "private-provider-continuation", "private title"]) expect(text).not.toContain(forbidden);
  await build("build:newer");
  expect(await listBuildFacts(ports, workspaceId, 1)).toHaveLength(1);
  await expect(listBuildFacts(ports, workspaceId, 101)).rejects.toThrow();
});

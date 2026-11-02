import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createStewardService } from "./service";
import { handleModuleCall } from "./module-effects";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

test("content.read: a module that declared it reads another app's content by reference; others are refused; sizes and paths are bounded", async () => {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-content-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const w = (await db.workspace.create({ data: { name: "content" } })).id;
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-01T00:00:00Z"), publicUrl: null };
  createStewardService(ports);
  const images = await db.module.create({ data: { workspaceId: w, name: "image-generation", activeHash: "i1" } });
  await mkdir(join(dataDir, "platform/content", images.id), { recursive: true });
  await writeFile(join(dataDir, "platform/content", images.id, "cat.png"), "png-bytes");
  await writeFile(join(dataDir, "platform/content", images.id, "big.png"), Buffer.alloc(10 * 1024 * 1024 + 1));
  const caller = async (name: string, uses: string[], ref: string) => {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], uses });
    const row = await db.module.upsert({ where: { workspaceId_name: { workspaceId: w, name } }, create: { workspaceId: w, name, activeHash: name }, update: {} });
    await db.moduleVersion.upsert({ where: { moduleId_hash: { moduleId: row.id, hash: name } }, create: { moduleId: row.id, hash: name, manifest, source: "build", intent: {}, report: {}, status: "approved" }, update: {} });
    return handleModuleCall(ports, { workspaceId: w, moduleId: row.id, hash: name, manifest }, { id: "1", method: "call", params: { target: "content.read", args: { ref }, mode: "sync", reply: false } });
  };
  expect(await caller("mcp", ["content.read"], "image-generation/cat.png")).toMatchObject({ result: { output: {
    ref: "image-generation/cat.png", name: "cat.png", mime: "image/png", bytes: 9, base64: Buffer.from("png-bytes").toString("base64"), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
  // Not declared in `uses` (so never approved): refused, even for an entry module.
  expect(await caller("web", [], "image-generation/cat.png")).toMatchObject({ error: { code: "undeclared" } });
  expect(await caller("mcp", ["content.read"], "image-generation/big.png")).toMatchObject({ error: { code: "invalid" } });
  expect(await caller("mcp", ["content.read"], "image-generation/../../secret")).toMatchObject({ error: { code: "invalid" } });
  expect(await caller("mcp", ["content.read"], "nobody/cat.png")).toMatchObject({ error: { code: "not_found" } });
});

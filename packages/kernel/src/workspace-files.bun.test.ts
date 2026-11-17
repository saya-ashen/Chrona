import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { contentRefSchema } from "@chrona/contracts/steward";
import { testDb } from "./__testing__/test-db";
import type { StewardPorts } from "./ports";
import { readWorkspaceFile, FILE_MAX_BYTES } from "./workspace-files";
import { readRunContent } from "./execution/run-content";


async function fixture() {
  const db = testDb(), root = await mkdtemp(join(tmpdir(), "chrona-file-ownership-"));
  const workspace = await db.workspace.create({ data: { name: "files" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "web", activeHash: "approved", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "approved", status: "approved", source: "user", intent: {}, report: {}, manifest: { name: "web", entry: "index.ts", tests: ["test.ts"], effects: [] } } });
  const ports: StewardPorts = { db, dataDir: root, now: () => new Date(), publicUrl: null };
  const content = join(root, "platform/content", module.id);
  await mkdir(content, { recursive: true });
  const cwd = join(root, "project"); await mkdir(cwd);
  return { db, root, ports, content, cwd, workspaceId: workspace.id, moduleId: module.id, async close() { await db.$disconnect(); await rm(root, { recursive: true, force: true }); } };
}

test("build references read bounded cwd bytes directly, without shared attachment copies", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.cwd, "reference.txt"), "selected bytes");
    expect((await readWorkspaceFile(f.cwd, "reference.txt")).bytes.toString()).toBe("selected bytes");
    await writeFile(join(f.root, "private.txt"), "private");
    await symlink(join(f.root, "private.txt"), join(f.cwd, "escape"));
    for (const path of ["../private.txt", "escape"]) await expect(readWorkspaceFile(f.cwd, path)).rejects.toMatchObject({ code: "forbidden" });
    await expect(readWorkspaceFile(f.cwd, "missing")).rejects.toMatchObject({ code: "not_found" });
    await truncate(join(f.cwd, "reference.txt"), FILE_MAX_BYTES + 1);
    await expect(readWorkspaceFile(f.cwd, "reference.txt")).rejects.toMatchObject({ code: "invalid" });
    expect(await f.db.moduleInvocation.count()).toBe(0);
    expect(await Bun.file(join(f.root, "content/chat")).exists()).toBe(false);
  } finally { await f.close(); }
});

test("Agent input reads only the receipt's originating application, not arbitrary refs", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.content, "image.png"), "own image");
    expect((await readRunContent(f.ports, f.workspaceId, f.moduleId, "web/image.png")).bytes.toString()).toBe("own image");
    await expect(readRunContent(f.ports, f.workspaceId, "foreign", "web/image.png")).rejects.toMatchObject({ code: "forbidden" });
    await expect(readRunContent(f.ports, "foreign-workspace", f.moduleId, "web/image.png")).rejects.toMatchObject({ code: "forbidden" });
    await expect(readRunContent(f.ports, f.workspaceId, f.moduleId, "coding/image.png")).rejects.toMatchObject({ code: "forbidden" });
    expect(contentRefSchema.safeParse("chat/attachments/selected.png").success).toBe(true);
    await expect(readRunContent(f.ports, f.workspaceId, f.moduleId, "chat/old.txt")).rejects.toMatchObject({ code: "forbidden" });
    for (const ref of ["web/../private", "web/a/../../private"]) expect(contentRefSchema.safeParse(ref).success).toBe(false);
    await writeFile(join(f.root, "secret"), "outside");
    await symlink(join(f.root, "secret"), join(f.content, "escape"));
    await expect(readRunContent(f.ports, f.workspaceId, f.moduleId, "web/escape")).rejects.toMatchObject({ code: "forbidden" });
  } finally { await f.close(); }
});

test("an ordinary Chat application reads its own content without reviving shared attachments", async () => {
  const f = await fixture();
  try {
    const chat = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "chat", status: "active", activeHash: "chat-approved" } });
    const own = join(f.root, "platform/content", chat.id);
    await mkdir(own, { recursive: true });
    await writeFile(join(own, "selected.txt"), "selected Chat bytes");
    expect((await readRunContent(f.ports, f.workspaceId, chat.id, "chat/selected.txt")).bytes.toString()).toBe("selected Chat bytes");
    await expect(readRunContent(f.ports, f.workspaceId, f.moduleId, "chat/selected.txt")).rejects.toMatchObject({ code: "forbidden" });
    expect(await Bun.file(join(f.root, "content/chat/selected.txt")).exists()).toBe(false);
  } finally { await f.close(); }
});

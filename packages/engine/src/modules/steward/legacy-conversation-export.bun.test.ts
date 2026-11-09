import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { deleteExportedLegacyConversations, exportLegacyConversations, verifyLegacyConversationExport, type LegacyConversationExportOptions, LEGACY_CONVERSATION_SOURCES } from "./legacy-conversation-export";

const root = await mkdtemp(join(tmpdir(), "chrona-legacy-export-test-"));
const databaseUrl = `file:${join(root, "stage5-export-fix.db")}`;
ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve(import.meta.dirname, "../../../../../prisma/migrations") });
const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
afterAll(async () => { await db.$disconnect(); await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const directory = await mkdtemp(join(root, "stage5-export-"));
  const dataDir = join(directory, "data");
  await mkdir(join(dataDir, "platform/data/chat"), { recursive: true });
  const workspace = await db.workspace.create({ data: { name: "stage5 isolated regression" } });
  const session = await db.session.create({ data: { workspaceId: workspace.id, source: "web", key: "old-web", title: "obsolete transcript title", providerSessionId: "retained-provider-continuation" } });
  const attachment = { name: "old.txt", ref: `chat/${session.id}-old.txt`, mime: "text/plain", size: 12 };
  const file = join(dataDir, "platform/data/chat", attachment.ref.slice(5));
  await writeFile(file, "legacy bytes");
  const message = await db.message.create({ data: { workspaceId: workspace.id, sessionId: session.id, direction: "in", channel: "web", text: "legacy message", attachments: [attachment] } });
  const options: LegacyConversationExportOptions = { db, workspaceId: workspace.id, dataDir, outputDir: join(directory, "archive"), sessionIds: [session.id], offline: true };
  return { directory, options, workspace, session, message, attachment, file, close: () => rm(directory, { recursive: true, force: true }) };
}
async function finishedRun(f: Awaited<ReturnType<typeof fixture>>, sessionId = f.session.id) {
  return db.run.create({ data: { workspaceId: f.workspace.id, sessionId, lane: "background", trigger: "message", status: "finished", tokenHash: crypto.randomUUID(), provider: "fake", prompt: "old prompt", cwd: join(f.options.dataDir, "sessions", sessionId), startedAt: new Date(), endedAt: new Date() } });
}
async function execution(f: Awaited<ReturnType<typeof fixture>>, runId: string) {
  return db.executionAttempt.create({ data: { workspaceId: f.workspace.id, ownerId: "fixture", callerKey: "owner", workId: "work", commandKey: crypto.randomUUID(), requestDigest: "digest", runId, projectRef: "project", projectDigest: "digest", logDir: join(f.options.dataDir, "sessions", f.session.id), baseline: "baseline", budget: {}, stopConfirmedAt: new Date(), stopEvidence: { kind: "provider_exited" } } });
}

test("isolated EXPORT → VERIFY → DELETE scrubs old transcript metadata and unshared bytes, retains all execution/app identities and evidence", async () => {
  const f = await fixture();
  try {
    // Duplicate refs are counted, but bytes are archived once.
    await db.message.create({ data: { workspaceId: f.workspace.id, sessionId: f.session.id, direction: "out", channel: "web", text: "reply", attachments: [f.attachment], quotedMessageId: f.message.id } });
    const run = await finishedRun(f);
    const attempt = await execution(f, run.id);
    await db.executionDetail.create({ data: { attemptId: attempt.id, seq: 1, event: { evidence: "retained" }, bytes: 23, expiresAt: new Date("2099-01-01") } });
    await db.executionSnapshot.create({ data: { attemptId: attempt.id, snapshot: { artifact: "immutable.json" }, bytes: 25, expiresAt: new Date("2099-01-01") } });
    const context = await db.session.create({ data: { workspaceId: f.workspace.id, source: "module", key: "current", providerSessionId: "current-provider-continuation", executionHeadAttemptId: attempt.id } });
    await db.audit.create({ data: { id: `agent-context:${context.id}`, workspaceId: f.workspace.id, actorKey: "agent", kind: "agent_context", subjectId: context.id, details: {} } });
    const currentMessage = await db.message.create({ data: { workspaceId: f.workspace.id, sessionId: context.id, direction: "in", channel: "web", text: "current input" } });
    const module = await db.module.create({ data: { workspaceId: f.workspace.id, name: "memory-local" } });
    const preference = await db.preference.create({ data: { workspaceId: f.workspace.id, text: "remember", origin: "user" } });
    const paths = [join(attempt.logDir, "provider.jsonl"), join(attempt.logDir, "immutable.json"), join(f.options.dataDir, "platform/data", module.id, "memory.json"), join(f.options.dataDir, "platform/content", module.id, "private.txt"), join(f.options.dataDir, "platform/data/chat/orphan.txt")];
    for (const path of paths) { await mkdir(resolve(path, ".."), { recursive: true }); await writeFile(path, "protected bytes"); }
    const evidenceBefore = JSON.stringify(await Promise.all([db.run.findUnique({ where: { id: run.id } }), db.executionAttempt.findUnique({ where: { id: attempt.id } }), db.executionDetail.findMany({ where: { attemptId: attempt.id } }), db.executionSnapshot.findUnique({ where: { attemptId: attempt.id } })]));
    const result = await exportLegacyConversations(f.options);
    expect(result).toMatchObject({ sessions: 1, references: 2, files: 1, retainedFiles: 0 });
    expect(await verifyLegacyConversationExport(f.options, result.manifestSha256)).toEqual(result);
    const archive = await readFile(join(f.options.outputDir, "conversations.json"), "utf8");
    expect(archive).toContain("legacy message");
    expect(archive).not.toContain(run.tokenHash);
    expect(archive).not.toContain("current-provider-continuation");
    expect(await deleteExportedLegacyConversations(f.options, { ...result, authorizeDelete: true })).toMatchObject({ deletedMessages: 2, deletedFiles: 1, retainedSessionIdentities: 1 });
    expect(await Bun.file(f.file).exists()).toBe(false);
    expect(await db.message.count({ where: { sessionId: f.session.id } })).toBe(0);
    expect(await db.session.findUnique({ where: { id: f.session.id } })).toEqual({ ...f.session, title: null, key: `archived:${f.session.id}`, status: "ended" });
    expect(JSON.parse(archive).sessions[0]).toMatchObject({ title: f.session.title, key: f.session.key });
    expect(await db.session.findUnique({ where: { id: context.id } })).toEqual(context);
    expect(await db.message.findUnique({ where: { id: currentMessage.id } })).toEqual(currentMessage);
    expect(await db.preference.findUnique({ where: { id: preference.id } })).toEqual(preference);
    expect(await db.module.findUnique({ where: { id: module.id } })).toEqual(module);
    expect(JSON.stringify(await Promise.all([db.run.findUnique({ where: { id: run.id } }), db.executionAttempt.findUnique({ where: { id: attempt.id } }), db.executionDetail.findMany({ where: { attemptId: attempt.id } }), db.executionSnapshot.findUnique({ where: { attemptId: attempt.id } })]))).toBe(evidenceBefore);
    for (const path of paths) expect(await readFile(path, "utf8")).toBe("protected bytes");
    expect(await readFile(join(f.options.outputDir, "manifest.json"), "utf8")).toContain(result.files.toString());
  } finally { await f.close(); }
});

test("explicit legacy source allowlist; module, audit-protected, unknown and foreign identities fail closed", async () => {
  const f = await fixture();
  try {
    expect(LEGACY_CONVERSATION_SOURCES).toEqual(["web", "qq", "mcp", "rescue", "wake", "build", "reflect"]);
    for (const source of LEGACY_CONVERSATION_SOURCES) {
      await db.session.update({ where: { id: f.session.id }, data: { source } });
      const options = { ...f.options, outputDir: join(f.directory, `archive-${source}`) };
      expect((await exportLegacyConversations(options)).sessions).toBe(1);
    }
    for (const source of ["module", "unknown"]) {
      await db.session.update({ where: { id: f.session.id }, data: { source } });
      await expect(exportLegacyConversations(f.options)).rejects.toThrow("protected");
    }
    await db.session.update({ where: { id: f.session.id }, data: { source: "web" } });
    await db.audit.create({ data: { workspaceId: f.workspace.id, actorKey: "agent", kind: "agent_context", subjectId: f.session.id, details: {} } });
    await expect(exportLegacyConversations(f.options)).rejects.toThrow("protected");
    await expect(exportLegacyConversations({ ...f.options, workspaceId: "foreign" })).rejects.toThrow("not found");
  } finally { await f.close(); }
});

for (const state of ["queued", "running", "unknown", "unconfirmed", "execution", "head"]) test(`reject ${state} Run/current execution evidence`, async () => {
  const f = await fixture();
  try {
    const run = await finishedRun(f);
    if (["queued", "running", "unknown"].includes(state)) await db.run.update({ where: { id: run.id }, data: { status: state } });
    if (state === "unconfirmed") await db.run.update({ where: { id: run.id }, data: { error: "Execution stop is unconfirmed" } });
    if (state === "execution") { const attempt = await execution(f, run.id); await db.executionAttempt.update({ where: { id: attempt.id }, data: { stopConfirmedAt: null } }); }
    if (state === "head") await db.session.update({ where: { id: f.session.id }, data: { executionHeadAttemptId: "current" } });
    await expect(exportLegacyConversations(f.options)).rejects.toThrow(state === "head" ? "protected" : "live or unknown");
    expect(await db.message.count({ where: { sessionId: f.session.id } })).toBe(1);
    expect(await Bun.file(f.file).exists()).toBe(true);
  } finally { await f.close(); }
});

for (const mutation of ["message", "source-bytes", "missing-source", "manifest", "archive-bytes", "archive-conversations", "missing-archive", "new-context", "new-live-run"]) test(`verification blocks deletion after ${mutation}`, async () => {
  const f = await fixture();
  try {
    const exported = await exportLegacyConversations(f.options);
    const manifest = JSON.parse(await readFile(join(f.options.outputDir, "manifest.json"), "utf8"));
    const archivedFile = join(f.options.outputDir, "files", manifest.files[0].sha256);
    if (mutation === "message") await db.message.update({ where: { id: f.message.id }, data: { text: "changed" } });
    if (mutation === "source-bytes") await writeFile(f.file, "changed bytes");
    if (mutation === "missing-source") await unlink(f.file);
    if (mutation === "manifest") await writeFile(join(f.options.outputDir, "manifest.json"), "{}");
    if (mutation === "archive-bytes") await writeFile(archivedFile, "corrupted");
    if (mutation === "archive-conversations") await writeFile(join(f.options.outputDir, "conversations.json"), "{}");
    if (mutation === "missing-archive") await unlink(archivedFile);
    if (mutation === "new-context") await db.audit.create({ data: { id: `agent-context:${f.session.id}`, workspaceId: f.workspace.id, actorKey: "agent", kind: "other", details: {} } });
    if (mutation === "new-live-run") { const run = await finishedRun(f); await db.run.update({ where: { id: run.id }, data: { status: "running" } }); }
    await expect(deleteExportedLegacyConversations(f.options, { manifestSha256: exported.manifestSha256, authorizeDelete: true })).rejects.toThrow();
    expect(await db.message.count({ where: { sessionId: f.session.id } })).toBe(1);
  } finally { await f.close(); }
});

for (const quoted of [false, true]) for (const protection of ["other-message", "run-evidence", "agent-input", "execution-detail", "execution-snapshot"]) test(`shared legacy file retained for ${protection}, quoted=${quoted}`, async () => {
  const f = await fixture();
  try {
    if (quoted) {
      const original = f.file;
      f.attachment.ref = `chat/${f.session.id}-a"b.txt`;
      f.file = join(f.options.dataDir, "platform/data/chat", f.attachment.ref.slice(5));
      await rename(original, f.file);
      await db.message.update({ where: { id: f.message.id }, data: { attachments: [f.attachment] } });
    }
    if (protection === "other-message") {
      const other = await db.session.create({ data: { workspaceId: f.workspace.id, source: "module", key: "protected" } });
      await db.message.create({ data: { workspaceId: f.workspace.id, sessionId: other.id, direction: "in", channel: "web", text: "protected", attachments: [f.attachment] } });
    }
    if (protection === "run-evidence") { const run = await finishedRun(f); await db.run.update({ where: { id: run.id }, data: { toolCalls: [{ ref: f.attachment.ref }] } }); }
    if (protection === "agent-input") await db.audit.create({ data: { workspaceId: f.workspace.id, actorKey: "agent", kind: "agent_tools", details: { content: [f.attachment.ref] } } });
    if (protection === "execution-detail" || protection === "execution-snapshot") {
      const run = await finishedRun(f);
      const attempt = await execution(f, run.id);
      if (protection === "execution-detail") await db.executionDetail.create({ data: { attemptId: attempt.id, seq: 1, event: { ref: f.attachment.ref }, bytes: 100, expiresAt: new Date("2099-01-01") } });
      else await db.executionSnapshot.create({ data: { attemptId: attempt.id, snapshot: { ref: f.attachment.ref }, bytes: 100, expiresAt: new Date("2099-01-01") } });
    }
    const protectedBefore = JSON.stringify(await Promise.all([db.message.findMany({ where: { sessionId: { not: f.session.id } } }), db.run.findMany(), db.audit.findMany(), db.executionDetail.findMany(), db.executionSnapshot.findMany()]));
    const result = await exportLegacyConversations(f.options);
    expect(result.retainedFiles).toBe(1);
    expect(await verifyLegacyConversationExport(f.options, result.manifestSha256)).toEqual(result);
    expect(await deleteExportedLegacyConversations(f.options, { ...result, authorizeDelete: true })).toMatchObject({ deletedMessages: 1, deletedFiles: 0 });
    expect(await readFile(f.file, "utf8")).toBe("legacy bytes");
    expect(JSON.stringify(await Promise.all([db.message.findMany({ where: { sessionId: { not: f.session.id } } }), db.run.findMany(), db.audit.findMany(), db.executionDetail.findMany(), db.executionSnapshot.findMany()]))).toBe(protectedBefore);
  } finally { await f.close(); }
});

test("reject missing referenced bytes, traversal, unsafe symlinks, source/archive overlap and outside quote mutation", async () => {
  const f = await fixture();
  try {
    await unlink(f.file);
    await expect(exportLegacyConversations(f.options)).rejects.toThrow();
    await writeFile(f.file, "legacy bytes");
    for (const ref of ["chat/../private", "chat/a/../../private", "chat/\\escape", "/etc/passwd", "web/private", "chat/.hidden"]) {
      await db.message.update({ where: { id: f.message.id }, data: { attachments: [{ ...f.attachment, ref }] } });
      await expect(exportLegacyConversations(f.options)).rejects.toThrow();
    }
    await db.message.update({ where: { id: f.message.id }, data: { attachments: [f.attachment] } });
    await writeFile(join(f.directory, "private"), "legacy bytes");
    await unlink(f.file);
    await symlink(join(f.directory, "private"), f.file);
    await expect(exportLegacyConversations(f.options)).rejects.toThrow("symlink");
    await unlink(f.file); await writeFile(f.file, "legacy bytes");
    await renameChatToSymlink(f);
    await expect(exportLegacyConversations(f.options)).rejects.toThrow("symlink");
    await unlink(join(f.options.dataDir, "platform/data/chat"));
    await rename(join(f.options.dataDir, "platform/data/real-chat"), join(f.options.dataDir, "platform/data/chat"));
    await expect(exportLegacyConversations({ ...f.options, outputDir: join(f.options.dataDir, "archive") })).rejects.toThrow("outside");
    const other = await db.session.create({ data: { workspaceId: f.workspace.id, source: "module", key: "protected" } });
    await db.message.create({ data: { workspaceId: f.workspace.id, sessionId: other.id, direction: "in", channel: "web", text: "protected", quotedMessageId: f.message.id } });
    await expect(exportLegacyConversations(f.options)).rejects.toThrow("quotes");
  } finally { await f.close(); }
});
test("a rehashed manifest cannot omit references or misreport counts", async () => {
  const f = await fixture();
  try {
    await exportLegacyConversations(f.options);
    const path = join(f.options.outputDir, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    for (const mutation of [{ ...manifest, files: [] }, { ...manifest, references: 0 }, { ...manifest, messages: 0 }]) {
      const text = JSON.stringify(mutation);
      await writeFile(path, text);
      const manifestSha256 = createHash("sha256").update(text).digest("hex");
      await expect(deleteExportedLegacyConversations(f.options, { manifestSha256, authorizeDelete: true })).rejects.toThrow("incomplete archive references");
    }
    expect(await db.message.findUnique({ where: { id: f.message.id } })).toEqual(f.message);
    expect(await readFile(f.file, "utf8")).toBe("legacy bytes");
  } finally { await f.close(); }
});

test("invalid or unavailable attachment metadata never yields an export", async () => {
  const f = await fixture();
  try {
    for (const attachment of [{ ...f.attachment, ref: null }, { ...f.attachment, size: 13 }, { ...f.attachment, sha256: "0".repeat(64) }]) {
      await db.message.update({ where: { id: f.message.id }, data: { attachments: [attachment] } });
      await expect(exportLegacyConversations(f.options)).rejects.toThrow();
      expect(await Bun.file(join(f.options.outputDir, "manifest.json")).exists()).toBe(false);
    }
  } finally { await f.close(); }
});

test("explicit offline/delete authorization and readable non-symlink archive are required", async () => {
  const f = await fixture();
  try {
    await expect(exportLegacyConversations({ ...f.options, offline: false as never })).rejects.toThrow();
    const result = await exportLegacyConversations(f.options);
    await expect(deleteExportedLegacyConversations(f.options, { ...result, authorizeDelete: false as never })).rejects.toThrow();
    const manifest = join(f.options.outputDir, "manifest.json");
    const moved = join(f.directory, "manifest.json");
    await rename(manifest, moved);
    await symlink(moved, manifest);
    await expect(deleteExportedLegacyConversations(f.options, { ...result, authorizeDelete: true })).rejects.toThrow("symlink");
    expect(await db.message.findUnique({ where: { id: f.message.id } })).toEqual(f.message);
    expect(await readFile(f.file, "utf8")).toBe("legacy bytes");
  } finally { await f.close(); }
});

test("database failure after file staging restores individual bytes and rolls back messages", async () => {
  const f = await fixture();
  const trigger = `stage5_${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    const result = await exportLegacyConversations(f.options);
    // Isolated regression DB only: force failure at the actual message deletion boundary.
    await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE DELETE ON "Message" WHEN OLD."id" = '${f.message.id.replaceAll("'", "''")}' BEGIN SELECT RAISE(ABORT, 'stage5 regression deletion failure'); END`);
    await expect(deleteExportedLegacyConversations(f.options, { ...result, authorizeDelete: true })).rejects.toThrow();
    expect(await db.message.findUnique({ where: { id: f.message.id } })).toEqual(f.message);
    expect(await db.session.findUnique({ where: { id: f.session.id } })).toEqual(f.session);
    expect(await readFile(f.file, "utf8")).toBe("legacy bytes");
    expect(await verifyLegacyConversationExport(f.options, result.manifestSha256)).toEqual(result);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}"`);
    await f.close();
  }
});

test("UTF-8 conversations over 64 MiB fail before archive creation, preserving source", async () => {
  const f = await fixture();
  try {
    // Below the limit in JS characters, above it in actual archived UTF-8 bytes.
    const text = "界".repeat(Math.ceil(64 * 1024 * 1024 / 3));
    await db.message.update({ where: { id: f.message.id }, data: { text } });
    await expect(exportLegacyConversations(f.options)).rejects.toThrow("conversations exceed 64 MiB archive limit");
    await expect(lstat(f.options.outputDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await db.message.findUnique({ where: { id: f.message.id }, select: { text: true } })).toEqual({ text });
    expect(await db.session.findUnique({ where: { id: f.session.id } })).toEqual(f.session);
    expect(await readFile(f.file, "utf8")).toBe("legacy bytes");
  } finally { await f.close(); }
}, 30000);

test("metadata scrub failure rolls back message deletion and restores staged bytes", async () => {
  const f = await fixture();
  const trigger = `stage5_${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    const result = await exportLegacyConversations(f.options);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE UPDATE ON "Session" WHEN OLD."id" = '${f.session.id.replaceAll("'", "''")}' BEGIN SELECT RAISE(ABORT, 'stage5 regression metadata failure'); END`);
    await expect(deleteExportedLegacyConversations(f.options, { ...result, authorizeDelete: true })).rejects.toThrow();
    expect(await db.message.findUnique({ where: { id: f.message.id } })).toEqual(f.message);
    expect(await db.session.findUnique({ where: { id: f.session.id } })).toEqual(f.session);
    expect(await readFile(f.file, "utf8")).toBe("legacy bytes");
    expect(await verifyLegacyConversationExport(f.options, result.manifestSha256)).toEqual(result);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}"`);
    await f.close();
  }
});

async function renameChatToSymlink(f: Awaited<ReturnType<typeof fixture>>) {
  const chat = join(f.options.dataDir, "platform/data/chat"), target = join(f.options.dataDir, "platform/data/real-chat");
  await rename(chat, target); await symlink(target, chat);
}

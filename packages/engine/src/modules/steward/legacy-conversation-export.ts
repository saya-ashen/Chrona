import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve } from "node:path";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";
import { readBoundedFile } from "./workspace-files";

// Host-only, stopped-service maintenance. Never register this as a module tool.
export const LEGACY_CONVERSATION_SOURCES = ["web", "qq", "mcp", "rescue", "wake", "build", "reflect"] as const;
export interface LegacyConversationExportOptions {
  db: StewardPorts["db"];
  workspaceId: string;
  dataDir: string;
  /** New archive directory, outside dataDir. Parent must already exist. */
  outputDir: string;
  /** Explicit identities; source alone never authorizes deletion. */
  sessionIds: string[];
  /** Caller must stop the service and all writers before invoking any phase. */
  offline: true;
}
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const digest = (value: unknown) => hash(JSON.stringify(value));
const fail = (message: string): never => { throw new Error(`Legacy conversation export: ${message}`); };
const refSchema = z.string().regex(/^chat\/[^./\\\p{Cc}][^/\\\p{Cc}]*$/u);
const attachmentSchema = z.object({ ref: refSchema, name: z.string(), size: z.number().int().nonnegative(), mime: z.string().optional(), sha256: z.string().optional() }).strict();
const fileSchema = z.object({ ref: refSchema, size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/), retained: z.boolean() }).strict();
const manifestSchema = z.object({
  version: z.literal(1), workspaceId: z.string(), sessionIds: z.array(z.string()), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  conversationsSha256: z.string().regex(/^[a-f0-9]{64}$/), files: z.array(fileSchema), references: z.number().int().nonnegative(), messages: z.number().int().nonnegative(),
}).strict();
type Manifest = z.infer<typeof manifestSchema>;
type Tx = Prisma.TransactionClient;
const ARCHIVE_JSON_MAX_BYTES = 64 * 1024 * 1024;

/** Reject every symlink component, including trusted roots if replaced since invocation. */
async function safePath(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path) fail("host paths must be absolute and canonical");
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) fail(`unsafe symlink: ${current}`);
  }
  return path;
}
function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
async function roots(options: LegacyConversationExportOptions, existing: boolean) {
  z.literal(true).parse(options.offline);
  if (!options.sessionIds.length || new Set(options.sessionIds).size !== options.sessionIds.length) fail("explicit unique sessionIds required");
  await safePath(options.dataDir);
  if (!isAbsolute(options.outputDir) || resolve(options.outputDir) !== options.outputDir || inside(options.dataDir, options.outputDir) || inside(options.outputDir, options.dataDir)) fail("archive must be outside dataDir");
  await safePath(existing ? options.outputDir : resolve(options.outputDir, ".."));
}
function refs(attachments: unknown) {
  return z.array(attachmentSchema).parse(attachments);
}

// Unknown statuses and unknown stop evidence are blocking, not terminal success.
function assertStoppedRuns(runs: Prisma.RunGetPayload<{ include: { execution: true } }>[], workspaceId: string) {
  for (const run of runs) {
    if (run.workspaceId !== workspaceId) continue;
    if (!["finished", "failed", "timed_out", "cancelled", "provider_unavailable"].includes(run.status) || run.error === "Execution stop is unconfirmed" || (run.startedAt && !run.endedAt)) fail("live or unknown Run/execution evidence");
    if (run.execution && (!run.execution.stopConfirmedAt || !run.execution.stopEvidence || run.execution.heldDirectory)) fail("live or unknown Run/execution evidence");
  }
}

async function snapshot(tx: Tx, options: LegacyConversationExportOptions) {
  const { workspaceId, sessionIds } = options;
  const sessions = await tx.session.findMany({ where: { workspaceId, id: { in: sessionIds } }, orderBy: { id: "asc" } });
  if (sessions.length !== sessionIds.length) fail("session not found in workspace");
  const audits = await tx.audit.findMany({ orderBy: { id: "asc" } });
  for (const session of sessions) {
    if (!(LEGACY_CONVERSATION_SOURCES as readonly string[]).includes(session.source) || session.executionHeadAttemptId || audits.some(row => row.id === `agent-context:${session.id}` || (row.kind === "agent_context" && row.subjectId === session.id))) fail("protected Agent/current execution context");
  }
  const runs = await tx.run.findMany({ orderBy: { id: "asc" }, include: { execution: true } });
  assertStoppedRuns(runs, workspaceId);
  const messages = await tx.message.findMany({ where: { workspaceId, sessionId: { in: sessionIds } }, orderBy: { id: "asc" } });
  const ids = messages.map(row => row.id);
  if (await tx.message.count({ where: { id: { notIn: ids }, quotedMessageId: { in: ids } } })) fail("outside message quotes selected message; deletion would mutate protected data");
  const others = await tx.message.findMany({ where: { id: { notIn: ids } }, orderBy: { id: "asc" } });
  const details = await tx.executionDetail.findMany({ orderBy: [{ attemptId: "asc" }, { seq: "asc" }] });
  const snapshots = await tx.executionSnapshot.findMany({ orderBy: { attemptId: "asc" } });
  // Only conversation metadata/messages are exported. Credentials, Run tokens, logs and audit payloads are never archived.
  const conversations = { sessions: sessions.map(({ id, workspaceId, source, key, title, status, originSessionId, createdAt, endedAt, lastActivityAt }) => ({ id, workspaceId, source, key, title, status, originSessionId, createdAt, endedAt, lastActivityAt })), messages };
  const references = messages.flatMap(row => refs(row.attachments));
  const evidence = JSON.stringify([runs, audits, details, snapshots, others.map(row => row.text)]);
  const sharedRefs = new Set(others.flatMap(row => z.array(z.object({ ref: z.string() })).parse(row.attachments).map(file => file.ref)));
  const files = [...new Set(references.map(file => file.ref))].sort().map(ref => {
    const path = join(options.dataDir, "platform/data/chat", ref.slice(5));
    // Evidence and refs must use the same JSON escaping, including embedded quotes.
    const encodedRef = JSON.stringify(ref).slice(1, -1);
    return { ref, retained: sharedRefs.has(ref) || evidence.includes(encodedRef) || runs.some(run => run.execution && (inside(run.execution.logDir, path) || (run.execution.resolvedCwd !== null && inside(run.execution.resolvedCwd, path)))) };
  });
  return { conversations, references, files, sourceSha256: digest([sessions, messages, runs, audits, others, details, snapshots]) };
}
async function sourceFile(options: LegacyConversationExportOptions, ref: string) {
  const path = join(options.dataDir, "platform/data/chat", refSchema.parse(ref).slice(5));
  await safePath(path);
  return { path, bytes: await readBoundedFile(path) };
}
function counts(manifest: Manifest) {
  return { sessions: manifest.sessionIds.length, messages: manifest.messages, references: manifest.references, files: manifest.files.length, retainedFiles: manifest.files.filter(file => file.retained).length };
}

/** Phase 1: create a private directory archive; returns its digest for the verify/delete confirmation. */
export async function exportLegacyConversations(options: LegacyConversationExportOptions) {
  await roots(options, false);
  const source = await options.db.$transaction(tx => snapshot(tx, options));
  const conversations = JSON.stringify(source.conversations, null, 2);
  if (Buffer.byteLength(conversations) > ARCHIVE_JSON_MAX_BYTES) fail("conversations exceed 64 MiB archive limit; select fewer sessions");
  // Read every referenced byte before creating an archive. Missing bytes never yield a deletable export.
  const files = [];
  for (const file of source.files) {
    const { bytes } = await sourceFile(options, file.ref);
    for (const ref of source.references.filter(row => row.ref === file.ref)) {
      if (ref.size !== bytes.length || (ref.sha256 !== undefined && ref.sha256 !== hash(bytes))) fail("referenced bytes do not match metadata");
    }
    files.push({ ...file, bytes, size: bytes.length, sha256: hash(bytes) });
  }
  await mkdir(options.outputDir, { mode: 0o700 });
  await mkdir(join(options.outputDir, "files"), { mode: 0o700 });
  await writeFile(join(options.outputDir, "conversations.json"), conversations, { flag: "wx", mode: 0o600 });
  const written = new Set<string>();
  for (const file of files) {
    if (written.has(file.sha256)) continue;
    await writeFile(join(options.outputDir, "files", file.sha256), file.bytes, { flag: "wx", mode: 0o600 });
    written.add(file.sha256);
  }
  const manifest: Manifest = { version: 1, workspaceId: options.workspaceId, sessionIds: [...options.sessionIds].sort(), sourceSha256: source.sourceSha256, conversationsSha256: hash(conversations), files: files.map(({ bytes: _bytes, ...file }) => file), references: source.references.length, messages: source.conversations.messages.length };
  const text = JSON.stringify(manifest, null, 2);
  await writeFile(join(options.outputDir, "manifest.json"), text, { flag: "wx", mode: 0o600 });
  return { manifestSha256: hash(text), ...counts(manifest) };
}

async function verifyArchiveFiles(options: LegacyConversationExportOptions, manifest: Manifest) {
  for (const file of manifest.files) {
    const archivedPath = await safePath(join(options.outputDir, "files", file.sha256));
    const archived = await readBoundedFile(archivedPath);
    const { bytes } = await sourceFile(options, file.ref);
    if (bytes.length !== file.size || hash(bytes) !== file.sha256 || archived.length !== file.size || hash(archived) !== file.sha256) fail("source/archive file mismatch");
  }
  const expected = new Set(manifest.files.map(file => file.sha256));
  for (const name of await readdir(await safePath(join(options.outputDir, "files")))) if (!expected.has(name)) fail("unexpected archive file");
}

async function verifyIn(tx: Tx, options: LegacyConversationExportOptions, manifestSha256: string) {
  await roots(options, true);
  const manifestPath = await safePath(join(options.outputDir, "manifest.json"));
  const text = await readBoundedFile(manifestPath, ARCHIVE_JSON_MAX_BYTES);
  if (hash(text) !== manifestSha256) fail("archive manifest digest mismatch");
  const manifest = manifestSchema.parse(JSON.parse(text.toString()));
  if (manifest.workspaceId !== options.workspaceId || digest(manifest.sessionIds) !== digest([...options.sessionIds].sort())) fail("archive scope mismatch");
  const source = await snapshot(tx, options);
  if (source.sourceSha256 !== manifest.sourceSha256) fail("source snapshot changed");
  const conversationPath = await safePath(join(options.outputDir, "conversations.json"));
  const conversations = await readBoundedFile(conversationPath, ARCHIVE_JSON_MAX_BYTES);
  if (hash(conversations) !== manifest.conversationsSha256 || digest(JSON.parse(conversations.toString())) !== digest(JSON.parse(JSON.stringify(source.conversations)))) fail("archive conversations mismatch");
  if (manifest.messages !== source.conversations.messages.length || manifest.references !== source.references.length || digest(manifest.files.map(({ ref, retained }) => ({ ref, retained }))) !== digest(source.files)) fail("incomplete archive references");
  await verifyArchiveFiles(options, manifest);
  return manifest;
}
/** Phase 2: independently reopen archive, compare complete references and frozen source. */
export async function verifyLegacyConversationExport(options: LegacyConversationExportOptions, manifestSha256: string) {
  const manifest = await options.db.$transaction(tx => verifyIn(tx, options, manifestSha256));
  return { manifestSha256, ...counts(manifest) };
}

/** Phase 3: explicit offline authorization, reverify under SQLite write lock, delete old transcript data.
 * Session identities MUST remain: Run.sessionId is SetNull and deleting sessions destroys evidence linkage.
 * Scrub title/routing key and end the old conversation; retain Provider continuation and relational evidence.
 * Only individually referenced, unshared chat files are removed; orphan files are never swept.
 */
export async function deleteExportedLegacyConversations(options: LegacyConversationExportOptions, confirmation: { manifestSha256: string; authorizeDelete: true }) {
  z.literal(true).parse(confirmation.authorizeDelete);
  const moved: { original: string; staged: string }[] = [];
  let committed = false;
  let staging: string | undefined;
  try {
    const result = await options.db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${options.workspaceId}`;
      const manifest = await verifyIn(tx, options, confirmation.manifestSha256);
      // Staging each file makes DB rollback recoverable without ever deleting a directory.
      const deletable = manifest.files.filter(row => !row.retained);
      if (deletable.length) {
        const chat = await safePath(join(options.dataDir, "platform/data/chat"));
        staging = join(chat, `.stage5-delete-${randomUUID()}`);
        await mkdir(staging, { mode: 0o700 });
      }
      for (const file of deletable) {
        const { path: original, bytes } = await sourceFile(options, file.ref);
        if (hash(bytes) !== file.sha256) fail("source changed before deletion");
        const staged = join(staging!, file.ref.slice(5));
        await rename(original, staged);
        moved.push({ original, staged });
        if (hash(await readBoundedFile(await safePath(staged))) !== file.sha256) fail("source changed during deletion");
      }
      await tx.message.deleteMany({ where: { workspaceId: options.workspaceId, sessionId: { in: options.sessionIds } } });
      for (const id of manifest.sessionIds) {
        await tx.session.update({ where: { id }, data: { title: null, key: `archived:${id}`, status: "ended" } });
      }
      // SQLite affected-row counts can include quote-FK updates; report the verified message set instead.
      return { ...counts(manifest), deletedMessages: manifest.messages, deletedFiles: moved.length, retainedSessionIdentities: manifest.sessionIds.length };
    }, { timeout: 60000 });
    committed = true;
    for (const file of moved) await unlink(await safePath(file.staged));
    if (staging) await rmdir(await safePath(staging));
    return result;
  } catch (error) {
    if (!committed) {
      for (const file of moved.reverse()) await rename(file.staged, file.original);
      if (staging) await rmdir(await safePath(staging));
    }
    throw error;
  }
}

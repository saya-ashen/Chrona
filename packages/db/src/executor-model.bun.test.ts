import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { ensureSqliteDatabase } from "./sqlite-migrations";

test("P2 device identity, assignment and source receipt commit together and survive detail deletion", async () => {
  const dir = await mkdtemp("/tmp/chrona-executor-schema-"), url = `file:${join(dir, "db.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") });
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) });
  try {
    const workspace = await db.workspace.create({ data: { name: "P2 temporary schema" } });
    const executor = await db.executionExecutor.create({ data: { id: "device", workspaceId: workspace.id, ownerId: "owner", label: "Fixture", credentialHash: "hash-only" } });
    const expiresAt = new Date("2026-11-07T00:00:00Z");
    await db.executorPairing.create({ data: { codeHash: "pair-hash", workspaceId: workspace.id, ownerId: "owner", expiresAt, receiptExpiresAt: expiresAt, executorId: executor.id, credentialHash: executor.credentialHash, consumedAt: new Date() } });
    const run = await db.run.create({ data: { workspaceId: workspace.id, lane: "background", trigger: "execution", provider: "fake-device", prompt: "fixture", cwd: join(dir, "logs"), tokenHash: "internal-hash", startedAt: new Date() } });
    const attempt = await db.executionAttempt.create({ data: { workspaceId: workspace.id, ownerId: "owner", callerKey: "owner", workId: "work", commandKey: "start", requestDigest: "digest", runId: run.id, projectRef: "project", projectDigest: "mapping", resolvedCwd: null, logDir: run.cwd, baseline: "commit:fixture", budget: {}, executorId: executor.id, executorGeneration: 1, mappingRevision: 2, directoryIdentity: "directory", queueExpiresAt: expiresAt, heldDirectory: '["device","directory"]' } });
    const data = { attemptId: attempt.id, assignmentId: "assignment", executorId: executor.id, generation: 1, incarnation: "incarnation", launchDigest: "launch-digest", launch: { bounded: true }, preparedAt: new Date(), offeredAt: new Date() };
    await db.executorAssignment.create({ data });
    expect(attempt.resolvedCwd).toBeNull();
    await expect(db.$transaction(async tx => {
      await tx.executorSourceReceipt.create({ data: { attemptId: attempt.id, sourceSeq: 1, throughSourceSeq: 1, digest: "source-digest", storedSeq: 1, bytes: 100 } });
      await tx.executionDetail.create({ data: { attemptId: attempt.id, seq: 1, event: { normalized: true }, bytes: 19, expiresAt } });
      await tx.executionAttempt.update({ where: { id: attempt.id }, data: { highWatermark: 1 } });
      throw new Error("receipt transaction rollback");
    })).rejects.toThrow("receipt transaction rollback");
    expect(await db.executorSourceReceipt.count()).toBe(0);
    expect(await db.executionDetail.count()).toBe(0);
    expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).highWatermark).toBe(0);
    await db.$transaction(async tx => {
      await tx.executorSourceReceipt.create({ data: { attemptId: attempt.id, sourceSeq: 1, throughSourceSeq: 1, digest: "source-digest", storedSeq: 1, bytes: 100 } });
      await tx.executionDetail.create({ data: { attemptId: attempt.id, seq: 1, event: { normalized: true }, bytes: 19, expiresAt } });
      await tx.executionAttempt.update({ where: { id: attempt.id }, data: { highWatermark: 1 } });
      await tx.executorAssignment.update({ where: { attemptId: attempt.id }, data: { sourceHighWatermark: 1, receiptCount: 1, receiptBytes: 100, finalDigest: "stable-final", final: { stop: "unknown" } } });
    });
    await db.executionDetail.deleteMany();
    expect(await db.executorSourceReceipt.count()).toBe(1);
    await expect(Promise.resolve(db.executorSourceReceipt.create({ data: { attemptId: attempt.id, sourceSeq: 1, throughSourceSeq: 1, digest: "different", bytes: 100 } }))).rejects.toMatchObject({ code: "P2002" });
    await db.executionExecutor.update({ where: { id: executor.id }, data: { generation: 2, revokedAt: new Date(), authorizedUntil: null } });
    expect(await db.executorAssignment.findUniqueOrThrow({ where: { attemptId: attempt.id } })).toMatchObject({ generation: 1, finalDigest: "stable-final", finalizedAt: null });
    expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).heldDirectory).not.toBeNull();
    await expect(Promise.resolve(db.executionExecutor.delete({ where: { id: executor.id } }))).rejects.toMatchObject({ code: "P2003" });
    const columns = await db.$queryRawUnsafe<{ name: string }[]>('PRAGMA table_info("ExecutionExecutor")');
    expect(columns.map(column => column.name)).not.toContain("credential");
  } finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});

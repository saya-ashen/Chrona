import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { ensureSqliteDatabase } from "./sqlite-migrations";

test("fresh execution schema: Run admission and evidence share rollback, unique receipts/occupancy and bounded retention columns", async () => {
  const dir = await mkdtemp("/tmp/chrona-execution-schema-"), url = `file:${join(dir, "db.sqlite")}`;
  ensureSqliteDatabase({ databaseUrl: url, migrationsDir: resolve("prisma/migrations") });
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url }) });
  try {
    const workspace = await db.workspace.create({ data: { name: "fresh schema" } });
    const module = await db.module.create({ data: { workspaceId: workspace.id, name: "coding", activeHash: "approved" } });
    const runData = { workspaceId: workspace.id, lane: "provider", trigger: "execution", provider: "offline", prompt: "test", cwd: "/explicit/test" };
    const attemptData = { workspaceId: workspace.id, ownerId: "owner", callerKey: `module:${module.id}`, moduleId: module.id, callerHash: "approved", workId: "work", commandKey: "key", requestDigest: "digest", projectRef: "repo", projectDigest: "grant-digest", resolvedCwd: runData.cwd, logDir: join(dir, "logs"), baseline: "commit", budget: { timeoutMs: 1000, maxToolCalls: 1 }, heldDirectory: runData.cwd };
    await expect(db.$transaction(async tx => {
      const run = await tx.run.create({ data: { ...runData, tokenHash: "rolled-back" } });
      await tx.executionAttempt.create({ data: { ...attemptData, runId: run.id } });
      throw new Error("capacity");
    })).rejects.toThrow("capacity");
    expect(await db.run.count()).toBe(0); expect(await db.executionAttempt.count()).toBe(0);
    const run = await db.run.create({ data: { ...runData, tokenHash: "one" } });
    const attempt = await db.executionAttempt.create({ data: { ...attemptData, runId: run.id } });
    expect(attempt).toMatchObject({ snapshotChargeBytes: 0, controlChargeBytes: 0, detailBytes: 0, highWatermark: 0 });
    const second = await db.run.create({ data: { ...runData, tokenHash: "two" } });
    await expect(Promise.resolve(db.executionAttempt.create({ data: { ...attemptData, runId: second.id, heldDirectory: null } }))).rejects.toMatchObject({ code: "P2002" });
    await expect(Promise.resolve(db.executionAttempt.create({ data: { ...attemptData, runId: second.id, commandKey: "different" } }))).rejects.toMatchObject({ code: "P2002" });
    const expiresAt = new Date("2026-12-01T00:00:00Z");
    await db.$transaction(async tx => {
      await tx.executionDetail.create({ data: { attemptId: attempt.id, seq: 1, event: { normalized: true }, bytes: 19, expiresAt } });
      await tx.executionControl.create({ data: { attemptId: attempt.id, slot: "terminal", fact: { status: "confirmed" }, bytes: 22 } });
      await tx.executionSnapshot.create({ data: { attemptId: attempt.id, snapshot: { final: true }, bytes: 14, expiresAt } });
      await tx.executionCommand.create({ data: { attemptId: attempt.id, commandKey: "cancel-key", operation: "cancel", requestDigest: "cancel-digest", receipt: { accepted: true } } });
      await tx.run.update({ where: { id: run.id }, data: { status: "completed", endedAt: new Date() } });
      await tx.executionAttempt.update({ where: { id: attempt.id }, data: { heldDirectory: null, stopConfirmedAt: new Date(), stopEvidence: { exited: true }, highWatermark: 1, detailBytes: 19, snapshotChargeBytes: 14, controlChargeBytes: 22 } });
    });
    await db.executionAttempt.create({ data: { ...attemptData, runId: second.id, commandKey: "different" } });
    expect(await db.executionDetail.aggregate({ _sum: { bytes: true } })).toMatchObject({ _sum: { bytes: 19 } });
    expect(await db.executionSnapshot.findMany({ where: { expiresAt: { lte: expiresAt } } })).toHaveLength(1);
    await expect(Promise.resolve(db.executionDetail.create({ data: { attemptId: attempt.id, seq: 1, event: {}, bytes: 2, expiresAt } }))).rejects.toMatchObject({ code: "P2002" });
    await expect(Promise.resolve(db.run.delete({ where: { id: run.id } }))).rejects.toMatchObject({ code: "P2003" });
    const columns = await db.$queryRawUnsafe<{ name: string }[]>('PRAGMA table_info("ExecutionAttempt")');
    expect(columns.map(column => column.name)).not.toContain("status");
    expect((await db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).snapshotChargeBytes).toBe(14);
  } finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});

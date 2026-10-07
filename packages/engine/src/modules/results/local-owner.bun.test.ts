import { afterEach, beforeEach, expect, it } from "bun:test";
import { db, resetTestDb, seedWorkspace, seedTask } from "@chrona/db";
import { createLocalTaskResultsService } from "./local-owner";

const prior = process.env.CHRONA_RESULT_WRITES_ENABLED;
beforeEach(async () => { await resetTestDb(); process.env.CHRONA_RESULT_WRITES_ENABLED = "true"; });
afterEach(async () => { await resetTestDb(); if (prior === undefined) delete process.env.CHRONA_RESULT_WRITES_ENABLED; else process.env.CHRONA_RESULT_WRITES_ENABLED = prior; });
it("rechecks the trusted owner callback on every operation, not just construction", async () => {
  const { workspaceId } = await seedWorkspace(), { taskId } = await seedTask(workspaceId);
  let authorized = true, calls = 0;
  const service = createLocalTaskResultsService(async () => { calls++; return authorized; });
  expect(await service.read({ taskId })).toEqual({ result: null, version: null });
  authorized = false;
  await expect(service.read({ taskId })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  expect(calls).toBe(2);
  expect(await db.taskResult.count()).toBe(0);
});
it("does not leak failed owner-auth adapter internals", async () => {
  const service = createLocalTaskResultsService(async () => { throw new Error("Private authorization adapter detail"); });
  await expect(service.read({ taskId: "task" })).rejects.toMatchObject({ code: "STORAGE_ERROR", message: "Work-result operation could not be completed" });
  expect(await db.resultCommand.count()).toBe(0);
});

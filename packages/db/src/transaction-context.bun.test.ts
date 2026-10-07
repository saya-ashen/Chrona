import { beforeEach, describe, expect, it } from "bun:test";
import { db, withDatabaseTransaction, afterDatabaseCommit } from "./db";
import { resetTestDb, seedWorkspace, seedTask } from "./test-support";

beforeEach(resetTestDb);
describe("SQLite transaction guards", () => {
  it("counts direct rows rather than trigger writes for relation connect and updateMany", async () => {
    const { workspaceId } = await seedWorkspace();
    const { taskId } = await seedTask(workspaceId);
    const goal = await db.goal.create({ data: { workspaceId, title: "Goal", successCriteria: "Ready", status: "Active", tasks: { connect: { id: taskId } } } });
    expect(await db.task.findUnique({ where: { id: taskId } })).toMatchObject({ goalId: goal.id, configRevision: 1 });
    expect(await db.task.updateMany({ where: { id: taskId }, data: { title: "Updated" } })).toEqual({ count: 1 });
    expect(await db.task.updateMany({ where: { id: "missing" }, data: { title: "No" } })).toEqual({ count: 0 });
  });
  it("fences an unrelated write from another caller's rollback", async () => {
    const { workspaceId } = await seedWorkspace();
    const { taskId } = await seedTask(workspaceId);
    const entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
    const transaction = withDatabaseTransaction(async () => {
      await db.task.update({ where: { id: taskId }, data: { title: "Not committed" } });
      entered.resolve();
      await finish.promise;
      throw new Error("rollback");
    });
    const caught = transaction.catch((error: unknown) => error);
    await entered.promise;
    let outsideCompleted = false;
    const outside = db.task.update({ where: { id: taskId }, data: { description: "Must survive" } }).then(() => { outsideCompleted = true; });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(outsideCompleted).toBe(false);
    finish.resolve();
    expect(await caught).toBeInstanceOf(Error);
    await outside;
    expect(await db.task.findUnique({ where: { id: taskId } })).toMatchObject({ title: "Test Task", description: "Must survive", configRevision: 1 });
  });
  it("composes ordinary callback transactions and defers notifications until commit", async () => {
    let notified = false;
    await db.$transaction(async (tx) => {
      await tx.workspace.create({ data: { name: "Callback", status: "Active" } });
      // Existing helpers that use the exported client share their caller's scope.
      expect(await db.workspace.count()).toBe(1);
      afterDatabaseCommit(() => { notified = true; });
      expect(notified).toBe(false);
    });
    expect(notified).toBe(true);
  });
});

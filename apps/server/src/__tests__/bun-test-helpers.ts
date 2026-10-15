import { testDb } from "@chrona/engine/test-support";

/** Disposable OS-temp database only; never reset the application's configured database. */
export let db: ReturnType<typeof testDb>;
export async function resetTestDb() {
  if (db) await db.$disconnect();
  db = testDb();
}
export async function seedWorkspace(name = "Test Workspace") {
  const workspace = await db.workspace.create({ data: { name } });
  return { workspaceId: workspace.id };
}

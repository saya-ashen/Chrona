import { expect, test } from "bun:test";
import { testDb } from "@chrona/engine/test-support";
import { ensureDefaultWorkspace } from "./index.bun";

test("fresh database gets default workspace without seed; repeated startup preserves user edits", async () => {
  const db = testDb();
  try {
    expect(await db.workspace.count()).toBe(0);
    await ensureDefaultWorkspace(db);
    expect(await db.workspace.findUnique({ where: { id: "ws_default" } })).toMatchObject({ name: "Personal" });
    await db.workspace.update({ where: { id: "ws_default" }, data: { name: "Mine" } });
    await ensureDefaultWorkspace(db);
    expect(await db.workspace.count()).toBe(1);
    expect(await db.workspace.findUnique({ where: { id: "ws_default" } })).toMatchObject({ name: "Mine" });
  } finally { await db.$disconnect(); }
});

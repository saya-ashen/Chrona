import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "@chrona/engine/test-support";
import { migrateQqState } from "./qq-state-migration";

test("the kernel-era QQ binding moves into the qq module once and is never overwritten", async () => {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-qq-migrate-"));
  try {
    await db.workspace.create({ data: { id: "w", name: "test" } });
    const module = await db.module.create({ data: { workspaceId: "w", name: "qq", builtin: true } });
    const legacy = join(dataDir, "qq-bot", "12345"), target = join(dataDir, "platform", "data", module.id);
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "binding.json"), "old"); await writeFile(join(legacy, "seen.json"), "[]"); await writeFile(join(legacy, "challenge.json"), "x");
    await migrateQqState(db, dataDir, {});
    expect(existsSync(target)).toBe(false);
    await migrateQqState(db, dataDir, { CHRONA_QQ_APP_ID: "12345" });
    expect(await readFile(join(target, "binding.json"), "utf8")).toBe("old");
    expect(await readFile(join(target, "seen.json"), "utf8")).toBe("[]");
    expect(existsSync(join(target, "challenge.json"))).toBe(false);
    await writeFile(join(target, "binding.json"), "new");
    await migrateQqState(db, dataDir, { CHRONA_QQ_APP_ID: "12345" });
    expect(await readFile(join(target, "binding.json"), "utf8")).toBe("new");
  } finally { await db.$disconnect(); }
});

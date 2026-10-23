import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@chrona/db";

/**
 * QQ moved from the kernel into the built-in qq module (v2-4d): carry the owner binding and the
 * seen-message ids over once, so the owner need not bind again. The old directory stays as it was.
 */
export async function migrateQqState(db: PrismaClient, dataDir: string, env = process.env) {
  const appId = env.CHRONA_QQ_APP_ID?.trim();
  if (!appId) return;
  const legacy = env.CHRONA_QQ_STATE_DIR?.trim() || join(dataDir, "qq-bot", appId);
  for (const module of await db.module.findMany({ where: { name: "qq", builtin: true } })) {
    const target = join(dataDir, "platform", "data", module.id);
    if (existsSync(join(target, "binding.json")) || !existsSync(join(legacy, "binding.json"))) continue;
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const file of ["seen.json", "binding.json"]) if (existsSync(join(legacy, file))) await copyFile(join(legacy, file), join(target, file));
  }
}

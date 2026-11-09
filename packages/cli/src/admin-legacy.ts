import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { deleteExportedLegacyConversations, exportLegacyConversations, verifyLegacyConversationExport, readBoundedFile } from "@chrona/engine";
import { getChronaDataDir } from "./start-server";

const scope = {
  workspaceId: z.string().min(1).max(256),
  sessionIds: z.array(z.string().min(1).max(256)).min(1).max(1000).refine(ids => new Set(ids).size === ids.length, "sessionIds must be unique"),
  outputDir: z.string().min(1).max(4096),
};
const manifestSha256 = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("export"), ...scope }).strict(),
  z.object({ operation: z.literal("verify"), ...scope, manifestSha256 }).strict(),
  z.object({ operation: z.literal("delete"), ...scope, manifestSha256, authorizeDelete: z.literal(true) }).strict(),
]);

/** Stopped-service maintenance only; the helper also rejects live/unknown execution evidence. */
export async function adminLegacy(file: string, options: { dataDir?: string; databaseUrl?: string } = {}) {
  const request = requestSchema.parse(JSON.parse((await readBoundedFile(file, 64 * 1024)).toString("utf8")));
  const dataDir = options.dataDir ?? getChronaDataDir();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? `file:${join(dataDir, "chrona.db")}`;
  const path = sqlitePathFromFileUrl(databaseUrl);
  if (!path || !existsSync(path)) throw new Error("Chrona database not found");
  // Verify also takes ownership: archive/source comparisons must have no concurrent service writer.
  const lock = acquireSqliteRuntimeLock(databaseUrl);
  let db: PrismaClient | undefined;
  try {
    db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
    let result;
    {
      const input = { db, dataDir, workspaceId: request.workspaceId, sessionIds: request.sessionIds, outputDir: request.outputDir, offline: true as const };
      switch (request.operation) {
        case "export": result = await exportLegacyConversations(input); break;
        case "verify": result = await verifyLegacyConversationExport(input, request.manifestSha256); break;
        case "delete": result = await deleteExportedLegacyConversations(input, request); break;
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    try { await db?.$disconnect(); } finally { lock.release(); }
  }
}

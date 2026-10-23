import { existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { createStewardService, moduleSupervisor } from "@chrona/engine";
import { getChronaDataDir } from "./start-server";

export type AdminCommand = "modules" | "rollback" | "disable" | "approvals" | "approve" | "reject";
/** Local filesystem ownership, never API_KEY or Provider credentials, authorizes administration. */
export async function runAdmin(command: AdminCommand, args: string[] = [], options: { dataDir?: string; databaseUrl?: string } = {}) {
  const dataDir = options.dataDir ?? getChronaDataDir();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? `file:${join(dataDir, "chrona.db")}`;
  const path = sqlitePathFromFileUrl(databaseUrl);
  if (!path || !existsSync(path)) throw new Error("Chrona database not found. Start Chrona once before using chrona admin.");
  const readOnly = command === "modules" || command === "approvals";
  const lock = readOnly ? undefined : acquireSqliteRuntimeLock(databaseUrl);
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  const ports = { db, dataDir, now: () => new Date(), publicUrl: null, deliveries: [], chat: null };
  try {
    // Offline administration updates generations without starting long-running modules.
    await moduleSupervisor(ports).stop();
    const workspaceId = "ws_default";
    const api = createStewardService(ports).forWorkspace(workspaceId);
    let result: unknown;
    if (command === "modules") result = [...await api.modules.list(), { name: "rescue", status: "immutable" }];
    else if (command === "approvals") result = await api.approvals.list("open");
    else if (command === "approve" || command === "reject") result = (await api.approvals.resolve(args[0]!, { decision: command === "approve" ? "approve" : "deny", scope: "once" }, "cli")).approval;
    else {
      const module = await db.module.findFirst({ where: { workspaceId, OR: [{ id: args[0] }, { name: args[0] }] } });
      if (!module) throw new Error("Module not found");
      if (command === "disable") result = await api.modules.disable(module.id, "cli");
      else {
        const version = args[1] === "builtin" ? await db.moduleVersion.findFirst({ where: { moduleId: module.id, source: "builtin", status: "approved" }, orderBy: { createdAt: "desc" } }) : null;
        const hash = args[1] === "builtin" ? version?.hash : args[1];
        if (!hash) throw new Error("Approved built-in module version not found");
        const rollback = await api.modules.rollback(module.id, hash);
        // Local administration is a trusted approval source, including data-restore confirmations.
        result = rollback.status === "pending_approval" ? (await api.approvals.resolve(rollback.approvalId, { decision: "approve", scope: "once" }, "cli")).approval : rollback;
        await db.audit.create({ data: { workspaceId, actorKey: "user", kind: "admin_rollback", subjectId: module.id, details: { source: "cli", hash } } });
      }
    }
    console.log(JSON.stringify(result, null, 2));
    if (!readOnly) console.log("Restart Chrona after changes to start modules with the new generation.");
    return result;
  } finally {
    await moduleSupervisor(ports).stop();
    await db.$disconnect();
    lock?.release();
  }
}

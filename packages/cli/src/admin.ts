import { existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { createQqBotState, createSecrets, createStewardService, moduleSupervisor } from "@chrona/engine";
import { getChronaDataDir } from "./start-server";

export type AdminCommand = "diagnostics" | "modules" | "rollback" | "disable" | "approvals" | "approve" | "reject";
type AdminApi = ReturnType<ReturnType<typeof createStewardService>["forWorkspace"]>;
async function changeModule(db: PrismaClient, api: AdminApi, command: AdminCommand, args: string[]) {
  const workspaceId = "ws_default";
  const module = await db.module.findFirst({ where: { workspaceId, OR: [{ id: args[0] }, { name: args[0] }] } });
  if (!module) throw new Error("Module not found");
  if (command === "disable") return api.modules.disable(module.id, "cli");
  const version = args[1] === "builtin" ? await db.moduleVersion.findFirst({ where: { moduleId: module.id, source: "builtin", status: "approved" }, orderBy: { createdAt: "desc" } }) : null;
  const hash = args[1] === "builtin" ? version?.hash : args[1];
  if (!hash) throw new Error("Approved built-in module version not found");
  const rollback = await api.modules.rollback(module.id, hash);
  // Local administration is a trusted approval source, including data-restore confirmations.
  const result = rollback.status === "pending_approval" ? (await api.approvals.resolve(rollback.approvalId, { decision: "approve", scope: "once" }, "cli")).approval : rollback;
  await db.audit.create({ data: { workspaceId, actorKey: "user", kind: "admin_rollback", subjectId: module.id, details: { source: "cli", hash } } });
  return result;
}
function adminLocation(options: { dataDir?: string; databaseUrl?: string }) {
  const dataDir = options.dataDir ?? getChronaDataDir();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? `file:${join(dataDir, "chrona.db")}`;
  return { dataDir, databaseUrl };
}
/** Local filesystem ownership, never API_KEY or Provider credentials, authorizes administration. */
export async function runAdmin(command: AdminCommand, args: string[] = [], options: { dataDir?: string; databaseUrl?: string } = {}) {
  const { dataDir, databaseUrl } = adminLocation(options);
  const path = sqlitePathFromFileUrl(databaseUrl);
  if (!path || !existsSync(path)) throw new Error("Chrona database not found. Start Chrona once before using chrona admin.");
  const readOnly = command === "modules" || command === "approvals" || command === "diagnostics";
  const lock = readOnly ? undefined : acquireSqliteRuntimeLock(databaseUrl);
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  const ports = { db, dataDir, now: () => new Date(), publicUrl: null, deliveries: [], chat: null };
  try {
    // Offline administration updates generations without starting long-running modules.
    await moduleSupervisor(ports).stop();
    const workspaceId = "ws_default";
    const api = createStewardService(ports).forWorkspace(workspaceId);
    const handlers: Partial<Record<AdminCommand, () => Promise<unknown>>> = {
      modules: async () => [...await api.modules.list(), { name: "rescue", status: "immutable" }],
      diagnostics: () => api.modules.diagnostics(args[0]),
      approvals: () => api.approvals.list("open"),
      approve: async () => (await api.approvals.resolve(args[0]!, { decision: "approve", scope: "once" }, "cli")).approval,
      reject: async () => (await api.approvals.resolve(args[0]!, { decision: "deny", scope: "once" }, "cli")).approval,
    };
    const handler = Object.hasOwn(handlers, command) ? handlers[command] : undefined;
    const result = handler ? await handler() : await changeModule(db, api, command, args);
    console.log(JSON.stringify(result, null, 2));
    if (!readOnly) console.log("Restart Chrona after changes to start modules with the new generation.");
    return result;
  } finally {
    await moduleSupervisor(ports).stop();
    await db.$disconnect();
    lock?.release();
  }
}

/** A one-time QQ owner binding code, written into the qq module's data directory (only its hash is stored). */
export async function qqBindCode(input: { workspace: string; ttlMinutes: number; replace: boolean }, options: { dataDir?: string; databaseUrl?: string } = {}) {
  const appId = process.env.CHRONA_QQ_APP_ID?.trim() ?? "";
  if (!/^\d{5,20}$/.test(appId)) throw new Error("CHRONA_QQ_APP_ID is required");
  const dataDir = options.dataDir ?? getChronaDataDir();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? `file:${join(dataDir, "chrona.db")}`;
  const path = sqlitePathFromFileUrl(databaseUrl);
  if (!path || !existsSync(path)) throw new Error("Chrona database not found. Start Chrona once first.");
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  try {
    const module = await db.module.findFirst({ where: { workspaceId: input.workspace, name: "qq" } });
    if (!module) throw new Error("The qq module is not registered in this workspace. Start Chrona once first.");
    const challenge = await createQqBotState(join(dataDir, "platform", "data", module.id), appId).createChallenge({ workspaceId: input.workspace, ttlMinutes: input.ttlMinutes, replace: input.replace });
    return { appId, ...challenge };
  } finally { await db.$disconnect(); }
}

/** Module credentials (v2-16), written to `<dataDir>/secrets` with the same rules as the page; the value is never printed. */
export async function setSecret(name: string, input: string, options: { dataDir?: string } = {}) {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(name) || name === "qq_bot") throw new Error("Invalid credential name");
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error("stdin must be a JSON object of string fields"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length || !Object.values(value).every(field => typeof field === "string" && field.length > 0)) {
    throw new Error("stdin must be a JSON object of non-empty string fields");
  }
  await createSecrets(adminLocation(options).dataDir).write(name, value as Record<string, string>);
  console.log(`Saved credential ${name} (${Object.keys(value).join(", ")}).`);
}
export async function removeSecret(name: string, options: { dataDir?: string } = {}) {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(name) || name === "qq_bot") throw new Error("Invalid credential name");
  await createSecrets(adminLocation(options).dataDir).remove(name);
  console.log(`Removed credential ${name}.`);
}

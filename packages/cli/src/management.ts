import { open, unlink } from "node:fs/promises";
import { lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { applyChronaRuntimeConfigToEnv } from "@chrona/shared/runtime-config";
import { MANAGEMENT_ACCESS_PRESETS, type ManagementAccessPreset } from "@chrona/contracts/api";
import { verifyMigrationReleaseMetadata, schemaFingerprint } from "@chrona/db/sqlite-migrations";
import { ensurePrivateDirectory, secureGeneratedPrivateFile, sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { findResourceDir, getChronaDataDir } from "./start-server";

/** Local filesystem authority, never an unauthenticated enrollment HTTP route.
 * Read-only schema check first: admin CLI never migrates a running service DB. */
async function managementAdmin() {
  applyChronaRuntimeConfigToEnv(process.env);
  process.env.DATABASE_URL ??= `file:${join(getChronaDataDir(), "chrona.db")}`;
  process.env.CHRONA_MIGRATIONS_DIR ??= join(findResourceDir(), "prisma/migrations");
  const path = sqlitePathFromFileUrl(process.env.DATABASE_URL);
  if (!path || path === ":memory:") throw new Error("Management administration needs an existing persistent Chrona database");
  const metadata = verifyMigrationReleaseMetadata(process.env.CHRONA_MIGRATIONS_DIR);
  const connection = new Database(path, { readonly: true, create: false });
  try {
    if (!metadata || schemaFingerprint(connection) !== metadata.releaseLineSchemaFingerprint) throw new Error("Database schema differs from this Chrona version. Upgrade via normal server startup before managing clients.");
  } finally { connection.close(); }
  return import("@chrona/engine");
}

export async function listLocalManagementClients() {
  return (await managementAdmin()).listManagementClients();
}
export async function revokeLocalManagementClient(clientId: string) {
  await (await managementAdmin()).revokeManagementClient(clientId);
}
export async function enrollLocalManagementClient(input: { name: string; publicUrl: string; timezone: string; tokenFile: string; access: string }) {
  if (!Object.hasOwn(MANAGEMENT_ACCESS_PRESETS, input.access)) throw new Error(`--access must be one of: ${Object.keys(MANAGEMENT_ACCESS_PRESETS).join(", ")}`);
  const scopes = [...MANAGEMENT_ACCESS_PRESETS[input.access as ManagementAccessPreset]];
  const admin = await managementAdmin();
  const path = resolve(input.tokenFile), parent = dirname(path);
  ensurePrivateDirectory(parent);
  if (process.platform !== "win32" && (lstatSync(parent).isSymbolicLink() || (lstatSync(parent).mode & 0o077) !== 0)) throw new Error("Token directory must be private (0700), not a symlink");
  const file = await open(path, "wx", 0o600);
  let clientId: string | undefined;
  try {
    secureGeneratedPrivateFile(path);
    const result = await admin.createManagementClient({ name: input.name, publicUrl: input.publicUrl, timezone: input.timezone, scopes });
    clientId = result.clientId;
    await file.writeFile(`${result.token}\n`, "utf8");
    await file.sync();
    return { clientId, tokenFile: path, endpoint: new URL("/api/mcp/management", input.publicUrl).href };
  } catch {
    if (clientId) await admin.revokeManagementClient(clientId);
    await unlink(path);
    throw new Error("Management enrollment failed; no credential was printed");
  } finally { await file.close(); }
}

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { MANAGEMENT_LEGACY_SCOPES, managementScopeSchema, managementModeSchema, managementTimezoneSchema } from "@chrona/contracts/api";
import { RESULT_SCOPES, ARTIFACT_SCOPES, PAGE_SCOPES } from "@chrona/contracts/results";
import { getDefaultWorkspace } from "../workspaces";
import { ManagementError } from "./errors";

export const managementClientInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  publicUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && url.pathname === "/" &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  }, "Use an HTTPS origin (or local HTTP origin), without credentials or path"),
  timezone: managementTimezoneSchema.default("UTC"),
  defaultMode: managementModeSchema.default("plan"),
  scopes: z.array(managementScopeSchema).min(1).default([...MANAGEMENT_LEGACY_SCOPES]),
}).strict();
export type ManagementIdentity = Awaited<ReturnType<typeof requireManagementClient>>;
export const managementTokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");

function validateWorkScopes(scopes: z.infer<typeof managementClientInputSchema>["scopes"]) {
  if ([...RESULT_SCOPES, ...ARTIFACT_SCOPES, ...PAGE_SCOPES].some((scope) => scopes.includes(scope)) && (!scopes.includes("tasks:read") || !scopes.includes("results:read"))) {
    throw new ManagementError("VALIDATION_ERROR", "Result capabilities require tasks:read and results:read");
  }
  if (scopes.some((s) => s.startsWith("library:")) && (!scopes.includes("tasks:read") || !scopes.includes("library:read"))) throw new ManagementError("VALIDATION_ERROR", "Library capabilities require tasks:read and library:read");
  if (scopes.includes("pages:write") && !scopes.includes("pages:read")) throw new ManagementError("VALIDATION_ERROR", "Page authoring requires pages:read");
  if (scopes.some(scope => scope === "work:read" || scope === "work:write") && (!scopes.includes("tasks:read") || !scopes.includes("work:read"))) {
    throw new ManagementError("VALIDATION_ERROR", "Work recording requires tasks:read and work:read");
  }
}
/** Local administration only; never expose this via a management MCP tool. */
export async function createManagementClient(raw: z.input<typeof managementClientInputSchema>) {
  const input = managementClientInputSchema.parse(raw);
  if (!input.scopes.includes("tasks:read") && !input.scopes.includes("goals:read")) throw new ManagementError("VALIDATION_ERROR", "Clients require tasks:read or goals:read");
  if ((input.scopes.includes("goals:propose") || input.scopes.includes("goals:write")) && !input.scopes.includes("goals:read")) throw new ManagementError("VALIDATION_ERROR", "Goal writes require goals:read");
  validateWorkScopes(input.scopes);
  const workspace = await getDefaultWorkspace();
  const token = `chrona_mgmt_${randomBytes(32).toString("base64url")}`;
  const client = await db.managementClient.create({ data: { ...input, scopes: [...new Set(input.scopes)], workspaceId: workspace.id, tokenDigest: managementTokenDigest(token) } });
  return { clientId: client.id, token };
}
export async function listManagementClients() {
  return db.managementClient.findMany({ select: { id: true, name: true, scopes: true, revokedAt: true, createdAt: true, publicUrl: true, timezone: true, defaultMode: true }, orderBy: { createdAt: "asc" } });
}
export async function revokeManagementClient(clientId: string) {
  await db.managementClient.update({ where: { id: clientId }, data: { revokedAt: new Date() } });
}
export async function requireManagementClient(token: string) {
  if (!/^chrona_mgmt_[A-Za-z0-9_-]{43}$/.test(token)) throw new ManagementError("AUTH_REQUIRED", "A management credential is required");
  const client = await db.managementClient.findUnique({ where: { tokenDigest: managementTokenDigest(token) } });
  if (!client || client.revokedAt) throw new ManagementError("AUTH_REQUIRED", "Management credential is invalid or revoked");
  const workspace = await db.workspace.findUnique({ where: { id: client.workspaceId }, select: { id: true } });
  if (!workspace) throw new ManagementError("AUTH_REQUIRED", "The authorized workspace no longer exists");
  return { ...client, scopes: z.array(managementScopeSchema).parse(client.scopes) };
}
export async function refreshManagementClient(client: ManagementIdentity) {
  const latest = await db.managementClient.findUnique({ where: { id: client.id } });
  if (!latest || latest.revokedAt || latest.tokenDigest !== client.tokenDigest || latest.workspaceId !== client.workspaceId) throw new ManagementError("AUTH_REQUIRED", "Management authorization changed");
  return { ...latest, scopes: z.array(managementScopeSchema).parse(latest.scopes) };
}

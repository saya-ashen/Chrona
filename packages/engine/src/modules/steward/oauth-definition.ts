import { createHash } from "node:crypto";
import { moduleManifestSchema, type ModuleManifest, type SecretSpec } from "@chrona/contracts/steward";
import { CallError } from "./modules/module-call-error";
import type { StewardPorts } from "./ports";

export type OAuthDefinition = {
  provider: NonNullable<SecretSpec["oauth"]>["provider"];
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  accounts?: boolean;
  authorizationParams?: Record<string, string>;
};
type OAuthBinding = { name: string; definition: OAuthDefinition; identity: string };
export type ApprovedOAuth = OAuthBinding & { moduleId: string };

/** Canonical identity survives unrelated code updates and object-key ordering. */
export function oauthDefinitionIdentity(name: string, definition: OAuthDefinition) {
  return createHash("sha256").update(JSON.stringify([name, definition.provider, definition.authorizationUrl, definition.tokenUrl,
    [...new Set(definition.scopes)].sort(), definition.accounts === true, Object.entries(definition.authorizationParams ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)])).digest("hex");
}
function definitions(manifest: Pick<ModuleManifest, "secrets">) {
  const result = new Map<string, OAuthBinding>();
  for (const secret of manifest.secrets) {
    if (typeof secret === "string" || !secret.oauth) continue;
    // The shared manifest schema validates the definition at the persisted boundary.
    const definition = secret.oauth as OAuthDefinition;
    result.set(secret.name, { name: secret.name, definition, identity: oauthDefinitionIdentity(secret.name, definition) });
  }
  return result;
}
/** Used by the existing activation approval gate, not a second approval mechanism. */
export function addsOAuthDefinitions(next: Pick<ModuleManifest, "secrets">, previous: Pick<ModuleManifest, "secrets"> | null) {
  const before = previous ? definitions(previous) : new Map<string, OAuthBinding>();
  return [...definitions(next)].some(([name, value]) => before.get(name)?.identity !== value.identity);
}

/** Only the current approved active definition may receive a credential. */
export async function resolveOAuthDefinition(ports: StewardPorts, workspaceId: string, name: string, provider: string, callerModuleId?: string): Promise<ApprovedOAuth> {
  const found = new Map<string, ApprovedOAuth>();
  const modules = await ports.db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null }, ...(callerModuleId ? { id: callerModuleId } : {}) }, select: { id: true, activeHash: true } });
  for (const module of modules) {
    const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    if (version?.status !== "approved") continue;
    const manifest = moduleManifestSchema.parse(version.manifest), definition = definitions(manifest).get(name);
    if (definition && definition.definition.provider === provider) found.set(definition.identity, { ...definition, moduleId: module.id });
  }
  if (found.size !== 1) throw new CallError("forbidden", "No unambiguous approved OAuth definition for this credential and provider");
  return found.values().next().value!;
}

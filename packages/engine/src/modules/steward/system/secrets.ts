import { publicSystemTools } from "./tool-contract-declarations";
import { secretNames, moduleManifestSchema, type ModuleManifest } from "@chrona/contracts/steward";
import { CallError, type Caller, type SystemModule } from "../module-calls";
import { createSecrets } from "../secrets";
import { authorizeOAuth, hiddenField, locked, oauthToken } from "../oauth";
import { resolveOAuthDefinition } from "../oauth-definition";
import { kernelField } from "../secret-fields";
import { audit } from "../audit";
import type { StewardPorts } from "../ports";
import { entry, json, parsed, requireOwner } from "./shared";
import { isOwnerCaller } from "../module-owner";

/**
 * `secrets` (v2-10, v2-16): `get` reads a credential the calling module lists in `secrets`; checked owners
 * save, remove and list them for the user. Values are never logged, stored in call records or returned by `list`.
 */
const SECRET_NAME = /^[a-z][a-z0-9_]{1,40}$/;
async function declaredSecrets(db: StewardPorts["db"], workspaceId: string) {
  const declared = new Map<string, string[]>();
  for (const module of await db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, select: { id: true, name: true, activeHash: true } })) {
    const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    const manifest = version?.status === "approved" ? moduleManifestSchema.safeParse(version.manifest).data : null;
    if (manifest?.name !== module.name) continue;
    for (const secret of secretNames(manifest)) declared.set(secret, [...declared.get(secret) ?? [], module.name]);
  }
  return declared;
}
async function approvedCallerManifest(db: StewardPorts["db"], workspaceId: string, caller: Extract<Caller, { kind: "module" }>): Promise<ModuleManifest | null> {
  const module = await db.module.findFirst({
    where: { id: caller.moduleId, workspaceId, name: caller.module, status: "active", activeHash: caller.hash },
    select: { versions: { where: { hash: caller.hash, status: "approved" }, select: { manifest: true } } },
  });
  const manifest = moduleManifestSchema.safeParse(module?.versions[0]?.manifest).data;
  return manifest?.name === caller.module ? manifest : null;
}
function secretValue(raw: unknown) {
  const value = parsed(raw, "value");
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length || Object.keys(value).length > 20
    || !Object.entries(value).every(([key, field]) => /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key) && typeof field === "string" && field.length > 0 && field.length <= 8192)) {
    throw new CallError("invalid", "value must be a JSON object of 1-20 non-empty string fields");
  }
  return value as Record<string, string>;
}
export const secrets: SystemModule = {
  name: "secrets",
  description: "凭据：保存你为应用设置的凭据，只交给声明了它的应用。",
  unrecorded: ["get", "set", "authorize", "token"],
  tools: publicSystemTools.secrets,
  // eslint-disable-next-line complexity -- Keep credential authorization branches together before dispatching to secret storage or OAuth.
  async handle({ ports, workspaceId, caller }, name, args) {
    const store = createSecrets(ports.dataDir);
    if (name === "set" || name === "remove" || name === "list") {
      await requireOwner(ports.db, workspaceId, caller);
      return manageSecrets(ports, workspaceId, store, name, args);
    }
    const module = caller.kind === "module" ? caller : null;
    const manifest = module ? await approvedCallerManifest(ports.db, workspaceId, module) : null;
    if (name === "get") {
      entry(caller);
      return readSecret(ports, store, manifest, String(args.name));
    }
    if (name === "authorize" || name === "token") {
      const secret = String(args.name), declared = !!manifest && secretNames(manifest).includes(secret);
      if (!SECRET_NAME.test(secret) || !(declared || (name === "authorize" && await isOwnerCaller(ports.db, workspaceId, caller)))) throw new CallError("forbidden", "Secret not declared");
      const approved = await resolveOAuthDefinition(ports, workspaceId, secret, String(args.provider), declared ? module!.moduleId : undefined);
      return json(name === "token" ? await oauthToken(ports, workspaceId, args, approved) : await authorizeOAuth(ports, workspaceId, args, approved));
    }
    throw new CallError("not_found", `secrets.${name} not found`);
  },
};
async function readSecret(ports: StewardPorts, store: ReturnType<typeof createSecrets>, manifest: ModuleManifest | null, secret: string) {
  if (!manifest || !secretNames(manifest).includes(secret)) throw new CallError("forbidden", "Secret not declared");
  // User-saved credentials take precedence over optional host-private defaults for any declared name.
  const value = await store.read(secret).then(value => value ?? ports.secrets?.(secret)).catch(() => null);
  if (!value) throw new CallError("unavailable", "Secret not configured");
  // Refresh tokens the kernel manages stay in the kernel (v2-30 §4); modules get access tokens from secrets.token.
  return json({ value: Object.fromEntries(Object.entries(value).filter(([field]) => !hiddenField(field, value))) });
}
/** Field edits preserve omitted values, but changing a client invalidates its OAuth authorizations. */
function mergeCredentialFields(current: Record<string, string> | null, value: Record<string, string>) {
  if (Object.keys(value).some(kernelField)) throw new CallError("invalid", "OAuth token and binding fields are written by Chrona: authorize instead");
  const changed = current && ["clientId", "clientSecret"].some(field => Object.hasOwn(value, field) && value[field] !== current[field]);
  const kept = changed ? Object.fromEntries(Object.entries(current).filter(([field]) => !kernelField(field))) : current;
  const merged = { ...kept, ...value };
  if (Object.keys(merged).length > 50) throw new CallError("invalid", "A credential holds at most 50 fields");
  return merged;
}
async function manageSecrets(ports: StewardPorts, workspaceId: string, store: ReturnType<typeof createSecrets>, name: "set" | "remove" | "list", args: Record<string, unknown>) {
  if (name === "list") {
    const saved = new Map((await store.list()).map(row => [row.name, row.updatedAt])), declared = await declaredSecrets(ports.db, workspaceId);
    return json(await Promise.all([...new Set([...saved.keys(), ...declared.keys()])].sort()
      .map(async secret => ({ name: secret, configured: saved.has(secret) || await ports.secretConfigured?.(secret) === true, updatedAt: saved.get(secret) ?? null, modules: declared.get(secret) ?? [] }))));
  }
  const secret = String(args.name);
  if (!SECRET_NAME.test(secret)) throw new CallError("invalid", "Invalid credential name");
  if (name === "remove" && args.field) {
    const field = String(args.field);
    // Under the kernel's lock for this credential, so an OAuth refresh never writes the field back (v2-30 §4).
    const left = await locked(`${ports.dataDir}\0${secret}`, async () => {
      const current = await store.read(secret);
      if (!current || !Object.hasOwn(current, field)) throw new CallError("not_found", `${secret} has no field ${field}`);
      const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== field && (!(field === "clientId" || field === "clientSecret") || !kernelField(key))));
      if (Object.keys(rest).length) await store.write(secret, rest); else await store.remove(secret);
      return Object.keys(rest).length > 0;
    });
    await audit(ports.db, { workspaceId, actor: "user", kind: left ? "secret_set" : "secret_removed", subjectId: null, details: { name: secret, field } });
    return json(left ? { name: secret, configured: true } : { name: secret, configured: false });
  }
  if (name === "remove") {
    await locked(`${ports.dataDir}\0${secret}`, () => store.remove(secret));
    await audit(ports.db, { workspaceId, actor: "user", kind: "secret_removed", subjectId: null, details: { name: secret } });
    return json({ name: secret, configured: false });
  }
  const value = secretValue(args.value);
  if (args.merge === true || args.merge === "true") {
    await locked(`${ports.dataDir}\0${secret}`, async () => {
      await store.write(secret, mergeCredentialFields(await store.read(secret), value));
    });
  } else {
    if (Object.keys(value).some(field => /^oauthBinding(_|$)/.test(field))) throw new CallError("invalid", "OAuth bindings are written by Chrona: authorize instead");
    await locked(`${ports.dataDir}\0${secret}`, () => store.write(secret, value));
  }
  // The name only: the value never reaches audits, call records or logs.
  await audit(ports.db, { workspaceId, actor: "user", kind: "secret_set", subjectId: null, details: { name: secret } });
  return json({ name: secret, configured: true });
}

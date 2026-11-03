import { z } from "zod";
import * as outputs from "../system-outputs";
import { isEntryModule, secretNames, moduleManifestSchema } from "@chrona/contracts/steward";
import { CallError, type SystemModule } from "../module-calls";
import { createSecrets } from "../secrets";
import { authorizeOAuth, hiddenField, locked, oauthToken } from "../oauth";
import { kernelField } from "../secret-fields";
import { audit } from "../audit";
import type { StewardPorts } from "../ports";
import { tool, text, entry, json, parsed, callerManifest } from "./shared";

/**
 * `secrets` (v2-10, v2-16): `get` reads a credential the calling module lists in `secrets`; entry modules (the page)
 * save, remove and list them for the user. Values are never logged, stored in call records or returned by `list`.
 */
const SECRET_NAME = /^[a-z][a-z0-9_]{1,40}$/;
async function declaredSecrets(db: StewardPorts["db"], workspaceId: string) {
  const declared = new Map<string, string[]>();
  for (const module of await db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, select: { id: true, name: true, activeHash: true } })) {
    const version = await db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    for (const secret of secretNames(moduleManifestSchema.safeParse(version?.manifest).data ?? {})) declared.set(secret, [...declared.get(secret) ?? [], module.name]);
  }
  return declared;
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
  tools: [
    tool("get", "A credential this module lists in its manifest's secrets.", { name: text() }, ["name"], { idempotent: true, output: z.lazy(() => outputs.secretGetOutput) }),
    tool("set", "Save a credential the user entered (entry modules): value is a JSON object of string fields; never returned. merge: keep the saved fields not in value (the page); otherwise the whole credential is replaced.", { name: text(), value: text("JSON object of strings"), merge: { type: "boolean" } }, ["name", "value"], { output: z.lazy(() => outputs.secretSetOutput) }),
    tool("remove", "Delete a saved credential, or only its field (entry modules), e.g. one account's password or OAuth authorization (refreshToken_<account>).", { name: text(), field: text("One field to delete") }, ["name"], { output: z.lazy(() => outputs.secretRemoveOutput) }),
    tool("list", "Saved credentials (name, update time) and the active modules declaring each (entry modules); never values.", {}, [], { idempotent: true, output: z.lazy(() => outputs.secretsListOutput) }),
    tool("authorize", "Start OAuth for a credential this module declares (v2-30 §4; entry modules: any). The credential must already hold clientId (and clientSecret) saved by the user; the provider app must list redirectUri. Give url to the user: they consent on the provider's page and the kernel saves the refresh token. scopes: space-separated; account: one of several accounts under one app.",
      { name: text(), provider: text("google | microsoft"), scopes: text("Space-separated OAuth scopes"), account: text("Optional account key") }, ["name", "provider", "scopes"], { output: z.lazy(() => outputs.secretAuthorizeOutput) }),
    tool("token", "A short-lived OAuth access token for a credential this module declares, refreshed by the kernel; error reauthorize when the user must authorize again. Never log, store or return it.",
      { name: text(), provider: text("google | microsoft"), account: text("Optional account key") }, ["name", "provider"], { idempotent: true, output: z.lazy(() => outputs.secretTokenOutput) }),
  ],
  // eslint-disable-next-line complexity -- Keep credential authorization branches together before dispatching to secret storage or OAuth.
  async handle({ ports, workspaceId, caller }, name, args) {
    const module = entry(caller), manifest = await callerManifest(ports.db, module), store = createSecrets(ports.dataDir);
    if (name === "get") return readSecret(ports, store, manifest, String(args.name));
    if (name === "authorize" || name === "token") {
      const secret = String(args.name), declared = !!manifest && secretNames(manifest).includes(secret);
      if (secret === "qq_bot" || !SECRET_NAME.test(secret) || !(declared || (name === "authorize" && manifest && isEntryModule(manifest)))) throw new CallError("forbidden", "Secret not declared");
      return json(name === "token" ? await oauthToken(ports, args) : await authorizeOAuth(ports, workspaceId, args));
    }
    if (name !== "set" && name !== "remove" && name !== "list") throw new CallError("not_found", `secrets.${name} not found`);
    if (!manifest || !isEntryModule(manifest)) throw new CallError("forbidden", "Only an entry module may manage credentials");
    return manageSecrets(ports, workspaceId, store, name, args);
  },
};
async function readSecret(ports: StewardPorts, store: ReturnType<typeof createSecrets>, manifest: Awaited<ReturnType<typeof callerManifest>>, secret: string) {
  if (!manifest || !secretNames(manifest).includes(secret) || (secret === "qq_bot" && !isEntryModule(manifest))) throw new CallError("forbidden", "Secret not declared");
  // qq_bot comes from the service environment; the others are saved by the user.
  const value = await (secret === "qq_bot" ? ports.secrets?.(secret) : store.read(secret))?.catch(() => null);
  if (!value) throw new CallError("unavailable", "Secret not configured");
  // Refresh tokens the kernel manages stay in the kernel (v2-30 §4); modules get access tokens from secrets.token.
  return json({ value: Object.fromEntries(Object.entries(value).filter(([field]) => !hiddenField(field, value))) });
}
async function manageSecrets(ports: StewardPorts, workspaceId: string, store: ReturnType<typeof createSecrets>, name: "set" | "remove" | "list", args: Record<string, unknown>) {
  if (name === "list") {
    const saved = new Map((await store.list()).map(row => [row.name, row.updatedAt])), declared = await declaredSecrets(ports.db, workspaceId);
    return json([...new Set([...saved.keys(), ...declared.keys()])].filter(secret => secret !== "qq_bot").sort()
      .map(secret => ({ name: secret, configured: saved.has(secret), updatedAt: saved.get(secret) ?? null, modules: declared.get(secret) ?? [] })));
  }
  const secret = String(args.name);
  if (!SECRET_NAME.test(secret) || secret === "qq_bot") throw new CallError("invalid", "Invalid credential name");
  if (name === "remove" && args.field) {
    const field = String(args.field);
    // Under the kernel's lock for this credential, so an OAuth refresh never writes the field back (v2-30 §4).
    const left = await locked(secret, async () => {
      const current = await store.read(secret);
      if (!current || !Object.hasOwn(current, field)) throw new CallError("not_found", `${secret} has no field ${field}`);
      const { [field]: _, ...rest } = current;
      if (Object.keys(rest).length) await store.write(secret, rest); else await store.remove(secret);
      return Object.keys(rest).length > 0;
    });
    await audit(ports.db, { workspaceId, actor: "user", kind: left ? "secret_set" : "secret_removed", subjectId: null, details: { name: secret, field } });
    return json(left ? { name: secret, configured: true } : { name: secret, configured: false });
  }
  if (name === "remove") {
    await locked(secret, () => store.remove(secret));
    await audit(ports.db, { workspaceId, actor: "user", kind: "secret_removed", subjectId: null, details: { name: secret } });
    return json({ name: secret, configured: false });
  }
  const value = secretValue(args.value);
  if (args.merge === true || args.merge === "true") {
    // The page saves field by field (v2-16 §2.1): fields left blank keep their saved values; kernel fields are not typed.
    if (Object.keys(value).some(kernelField)) throw new CallError("invalid", "refreshToken, scope and oauthManaged are written by Chrona: authorize instead");
    await locked(secret, async () => {
      const merged = { ...await store.read(secret), ...value };
      if (Object.keys(merged).length > 50) throw new CallError("invalid", "A credential holds at most 50 fields");
      /* Original suppression (no longer needed after splitting the registry):
      */
      await store.write(secret, merged);
    });
  } else await locked(secret, () => store.write(secret, value));
  // The name only: the value never reaches audits, call records or logs.
  await audit(ports.db, { workspaceId, actor: "user", kind: "secret_set", subjectId: null, details: { name: secret } });
  return json({ name: secret, configured: true });
}

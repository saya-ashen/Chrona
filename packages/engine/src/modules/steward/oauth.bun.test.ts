import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { handleModuleCall } from "./modules/module-effects";
import { completeOAuth, resetOAuth } from "./oauth";
import { addsOAuthDefinitions, oauthDefinitionIdentity, type OAuthDefinition } from "./oauth-definition";
import { createSecrets } from "./secrets";
import { secretView } from "./secret-fields";
import { registerSystemModule } from "./modules/module-calls";
import { secrets } from "./system/secrets";
import type { StewardPorts } from "./ports";

const google: OAuthDefinition = { provider: "google", authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", scopes: ["https://www.googleapis.com/auth/gmail.readonly"], accounts: true, authorizationParams: { access_type: "offline", prompt: "consent" } };
const microsoft: OAuthDefinition = { provider: "microsoft", authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token", scopes: ["IMAP.AccessAsUser.All", "offline_access"], accounts: true };
const cleanups: (() => Promise<unknown>)[] = [], realFetch = globalThis.fetch;
afterEach(async () => { globalThis.fetch = realFetch; resetOAuth(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(definition = google, publicUrl: string | null = "https://chrona.example", name = "mail_google") {
  registerSystemModule(secrets);
  const db = testDb({ injectedAgent: false });
  const dataDir = await mkdtemp("/tmp/chrona-oauth-");
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspaceId = (await db.workspace.create({ data: { name: "oauth" } })).id;
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl };
  const manifest = (oauth: OAuthDefinition) => moduleManifestSchema.parse({ name: "mail", entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: ["network"], secrets: [{ name, oauth }] });
  const initial = manifest(definition);
  const module = await db.module.create({ data: { workspaceId, name: "mail", activeHash: "v1" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest: initial, source: "provider", intent: {}, report: {}, status: "approved" } });
  let id = 0;
  async function call(target: string, args: Record<string, unknown>, callerId = module.id) {
    const row = await db.module.findUniqueOrThrow({ where: { id: callerId } });
    const version = await db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: callerId, hash: row.activeHash! } } });
    const reply = await handleModuleCall(ports, { workspaceId, moduleId: callerId, hash: row.activeHash!, manifest: moduleManifestSchema.parse(version.manifest) }, { id: String(++id), method: "call", params: { target, args: args as Record<string, string>, mode: "sync", reply: false } });
    if ("error" in reply) throw reply.error;
    return (reply as { result: { output: Record<string, any> } }).result.output;
  }
  const store = createSecrets(dataDir);
  await store.write(name, { clientId: "cid", clientSecret: "cs" });
  async function update(next: OAuthDefinition, hash = "v2") {
    await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest: manifest(next), source: "provider", intent: {}, report: {}, status: "approved" } });
    await db.module.update({ where: { id: module.id }, data: { activeHash: hash } });
  }
  async function bound(account = "", oauth = definition, token = "r-1") {
    const suffix = account ? `_${account}` : "";
    await store.write(name, { clientId: "cid", clientSecret: "cs", [`refreshToken${suffix}`]: token, [`oauthBinding${suffix}`]: oauthDefinitionIdentity(name, oauth), oauthManaged: "1" });
  }
  const args = { name, provider: definition.provider };
  async function authorize(account?: string) {
    const started = await call("secrets.authorize", { ...args, scopes: definition.scopes, ...(account ? { account } : {}) });
    const url = new URL(started.url);
    return { started, url, state: url.searchParams.get("state")! };
  }
  async function owner() {
    const manifest = moduleManifestSchema.parse({ name: "web", entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], uses: ["*"],
        authority: "owner"
    });
    const page = await db.module.create({ data: { workspaceId, name: "web", activeHash: "page" } });
    await db.moduleVersion.create({ data: { moduleId: page.id, hash: "page", manifest, source: "provider", intent: {}, report: {}, status: "approved" } });
    return (target: string, args: Record<string, unknown>) => call(target, args, page.id);
  }
  return { db, ports, store, module, workspaceId, call, update, bound, args, authorize, owner };
}
function provider(replies: (body: URLSearchParams) => { status?: number; json: Record<string, unknown> }) {
  const requests: { url: string; body: URLSearchParams }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = new URLSearchParams(String(init.body)), reply = replies(body);
    requests.push({ url: String(url), body });
    expect(init.redirect).toBe("error");
    return Response.json(reply.json, { status: reply.status ?? 200 });
  }) as typeof fetch;
  return requests;
}

test("manifest OAuth definitions require query-free HTTPS endpoints and cannot replace PKCE/state fields", () => {
  const parse = (oauth: unknown) => moduleManifestSchema.safeParse({ name: "mail", entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, secrets: [{ name: "mail_google", oauth }] }).success;
  expect(parse(google)).toBe(true);
  for (const authorizationUrl of ["http://example.com/auth", "https://u:p@example.com/auth", "https://example.com/auth?state=forged", "https://example.com/auth#fragment"]) expect(parse({ ...google, authorizationUrl })).toBe(false);
  for (const tokenUrl of ["http://example.com/token", "https://example.com/token?client_secret=x"]) expect(parse({ ...google, tokenUrl })).toBe(false);
  for (const name of ["state", "redirect_uri", "client_id", "scope", "response_type", "code_challenge", "code_challenge_method"]) expect(parse({ ...google, authorizationParams: { [name]: "forged" } })).toBe(false);
});

test("identity canonicalizes parameter and scope order; changed definitions require activation confirmation", () => {
  const spec = (oauth: OAuthDefinition) => ({ secrets: [{ name: "mail_google", fields: [], oauth }] });
  const reordered = { ...google, scopes: [...google.scopes, ...google.scopes], authorizationParams: { prompt: "consent", access_type: "offline" } };
  expect(oauthDefinitionIdentity("mail_google", google)).toBe(oauthDefinitionIdentity("mail_google", reordered));
  expect(addsOAuthDefinitions(spec(reordered), spec(google))).toBe(false);
  for (const changed of [{ ...google, tokenUrl: "https://new.example/token" }, { ...google, authorizationUrl: "https://new.example/auth" }, { ...google, authorizationParams: { prompt: "none" } }, { ...google, scopes: ["other"] }, { ...google, accounts: false }, microsoft]) {
    expect(addsOAuthDefinitions(spec(changed), spec(google))).toBe(true);
  }
  expect(addsOAuthDefinitions(spec(google), { secrets: ["mail_google"] })).toBe(true);
  expect(addsOAuthDefinitions({ secrets: [] }, spec(google))).toBe(false);
});

test("PKCE/state, Google offline extras, bound callback, rotation and cache remain functional", async () => {
  const f = await fixture(), { started, url, state } = await f.authorize("work");
  expect(started.redirectUri).toBe("https://chrona.example/oauth/callback");
  expect(url.origin + url.pathname).toBe(google.authorizationUrl);
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "cid", access_type: "offline", prompt: "consent", response_type: "code", code_challenge_method: "S256" });
  const requests = provider(body => body.get("grant_type") === "authorization_code" ? { json: { refresh_token: "r-1", scope: google.scopes[0] } } : { json: { access_token: "a-1", expires_in: 3600, refresh_token: "r-2" } });
  expect((await completeOAuth(f.ports, { state: "forged", code: "c" })).ok).toBe(false);
  expect((await completeOAuth(f.ports, { state, code: "c" })).ok).toBe(true);
  expect((await completeOAuth(f.ports, { state, code: "c" })).ok).toBe(false);
  expect(requests[0]!.body.get("code_verifier")).toBeTruthy();
  expect(await f.store.read("mail_google")).toMatchObject({ refreshToken_work: "r-1", oauthBinding_work: oauthDefinitionIdentity("mail_google", google), oauthManaged: "1" });
  const visible = await f.call("secrets.get", { name: "mail_google" });
  expect(visible.value).not.toHaveProperty("oauthBinding_work");
  expect(visible.value).not.toHaveProperty("refreshToken_work");
  expect(visible.value).not.toHaveProperty("clientSecret");
  await expect(f.call("secrets.token", f.args)).rejects.toMatchObject({ code: "unavailable", reason: "reauthorize" });
  for (let i = 0; i < 2; i++) expect(await f.call("secrets.token", { ...f.args, account: "work" })).toMatchObject({ accessToken: "a-1" });
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.url === google.tokenUrl)).toBe(true);
  expect((await f.store.read("mail_google"))!.refreshToken_work).toBe("r-2");
});

test("credential names do not grant or block OAuth: qq_bot follows its approved definition", async () => {
  const f = await fixture(google, "https://chrona.example", "qq_bot");
  const requests = provider(body => body.get("grant_type") === "authorization_code"
    ? { json: { refresh_token: "qq-refresh-private" } }
    : { json: { access_token: "qq-access-private", expires_in: 3600 } });
  const { state } = await f.authorize();
  expect((await completeOAuth(f.ports, { state, code: "code" })).ok).toBe(true);
  expect(await f.call("secrets.token", f.args)).toMatchObject({ accessToken: "qq-access-private" });
  expect(await f.call("secrets.get", { name: "qq_bot" })).toEqual({ value: { clientId: "cid", oauthManaged: "1" } });
  expect(requests.map(request => request.url)).toEqual([google.tokenUrl, google.tokenUrl]);
  const records = JSON.stringify([await f.db.moduleInvocation.findMany(), await f.db.moduleCall.findMany(), await f.db.audit.findMany()]);
  for (const value of ["qq-refresh-private", "qq-access-private"]) expect(records).not.toContain(value);

  // The same name without an approved OAuth definition has no OAuth capability.
  const where = { moduleId_hash: { moduleId: f.module.id, hash: "v1" } };
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where });
  await f.db.moduleVersion.update({ where, data: { manifest: { ...moduleManifestSchema.parse(version.manifest), secrets: ["qq_bot"] } } });
  await expect(f.call("secrets.authorize", { ...f.args, scopes: google.scopes })).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.call("secrets.token", f.args)).rejects.toMatchObject({ code: "forbidden" });
});

test("entry authorization uses the approved manifest; credential edits clear bindings and metadata stays private", async () => {
  const f = await fixture(), owner = await f.owner();
  const started = await owner("secrets.authorize", { ...f.args, scopes: google.scopes });
  expect(new URL(started.url).origin).toBe("https://accounts.google.com");
  await expect(owner("secrets.token", f.args)).rejects.toMatchObject({ code: "forbidden" });
  await f.bound("work");
  const spec = { name: "mail_google", fields: [], oauth: google };
  expect(secretView(spec, await f.store.read("mail_google")).oauth!.authorized).toEqual(["work"]);
  expect(secretView({ ...spec, oauth: { ...google, tokenUrl: "https://changed.example/token" } }, await f.store.read("mail_google")).oauth!.authorized).toEqual([]);
  for (const merge of [true, false]) await expect(owner("secrets.set", { name: "mail_google", merge, value: { oauthBinding_work: "forged" } })).rejects.toMatchObject({ code: "invalid" });
  await owner("secrets.set", { name: "mail_google", merge: true, value: { clientId: "new-client" } });
  expect(await f.store.read("mail_google")).toEqual({ clientId: "new-client", clientSecret: "cs" });
  await f.bound();
  await owner("secrets.remove", { name: "mail_google", field: "clientSecret" });
  expect(await f.store.read("mail_google")).toEqual({ clientId: "cid" });
});

test("entry authorization refuses ambiguous definitions for the same declared secret", async () => {
  const f = await fixture(), owner = await f.owner();
  const manifest = moduleManifestSchema.parse({ name: "other", entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: [], secrets: [{ name: "mail_google", oauth: { ...google, tokenUrl: "https://other.example/token" } }] });
  const module = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "other", activeHash: "v1" } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "v1", manifest, source: "provider", intent: {}, report: {}, status: "approved" } });
  await expect(owner("secrets.authorize", { ...f.args, scopes: google.scopes })).rejects.toMatchObject({ code: "forbidden" });
  expect(new URL((await f.authorize()).started.url).origin).toBe("https://accounts.google.com");
});

test("undeclared OAuth authorization requires checked owner authority rather than entry inference", async () => {
  const f = await fixture(), owner = await f.owner();
  const page = await f.db.module.findFirstOrThrow({ where: { workspaceId: f.workspaceId, name: "web" } });
  const where = { moduleId_hash: { moduleId: page.id, hash: "page" } };
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where });
  const manifest = moduleManifestSchema.parse(version.manifest);
  const args = { ...f.args, scopes: google.scopes };
  for (const part of [{ uses: ["secrets.authorize"] }, { uses: ["chat.send"] }, { uses: [], listen: "/" }]) {
    await f.db.moduleVersion.update({ where, data: { manifest: { ...manifest, authority: undefined, ...part } } });
    await expect(owner("secrets.authorize", args)).rejects.toMatchObject({ code: "forbidden" });
  }
  await f.db.moduleVersion.update({ where, data: { manifest, status: "candidate" } });
  await expect(owner("secrets.authorize", args)).rejects.toMatchObject({ code: "forbidden" });
  await f.db.moduleVersion.update({ where, data: { status: "approved" } });
  expect(new URL((await owner("secrets.authorize", args)).url).origin).toBe("https://accounts.google.com");
  const started = await secrets.handle({ ports: f.ports, workspaceId: f.workspaceId, caller: { kind: "owner", via: null } }, "authorize", args) as { url: string };
  expect(new URL(started.url).origin).toBe("https://accounts.google.com");
});

test("Microsoft offline_access is declared, not inferred from provider name", async () => {
  const f = await fixture(microsoft), { url } = await f.authorize();
  expect(url.searchParams.get("scope")).toBe("IMAP.AccessAsUser.All offline_access");
  expect(url.searchParams.has("access_type")).toBe(false);
  await f.bound();
  const requests = provider(() => ({ json: { access_token: "a", expires_in: 3600 } }));
  await f.call("secrets.token", f.args);
  expect(requests[0]!.url).toBe(microsoft.tokenUrl);
});

test("unbound legacy tokens and same-name endpoint changes never send credentials; rollback restores the matching binding", async () => {
  const f = await fixture();
  const requests = provider(() => ({ json: { access_token: "a", expires_in: 3600 } }));
  await f.store.write("mail_google", { clientId: "cid", refreshToken: "legacy" });
  await expect(f.call("secrets.token", f.args)).rejects.toMatchObject({ code: "unavailable", reason: "reauthorize" });
  await f.bound();
  await f.call("secrets.token", f.args);
  await f.update({ ...google, tokenUrl: "https://new.example/token" });
  await expect(f.call("secrets.token", f.args)).rejects.toMatchObject({ code: "unavailable", reason: "reauthorize" });
  expect(requests).toHaveLength(1);
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: "v1" } });
  await f.call("secrets.token", f.args);
  expect(requests).toHaveLength(1);
});

for (const change of ["definition", "client", "paused", "unapproved"] as const) test(`pending callback rejects changed ${change} before exchange`, async () => {
  const f = await fixture(), { state } = await f.authorize();
  if (change === "definition") await f.update({ ...google, tokenUrl: "https://new.example/token" });
  if (change === "client") await f.store.write("mail_google", { clientId: "changed", clientSecret: "cs" });
  if (change === "paused") await f.db.module.update({ where: { id: f.module.id }, data: { status: "paused" } });
  if (change === "unapproved") await f.db.moduleVersion.updateMany({ where: { moduleId: f.module.id }, data: { status: "pending_review" } });
  const requests = provider(() => ({ json: { refresh_token: "r" } }));
  expect((await completeOAuth(f.ports, { state, code: "c" })).ok).toBe(false);
  expect(requests).toHaveLength(0);
  expect(await f.store.read("mail_google")).not.toHaveProperty("refreshToken");
});

test("unrelated update and rollback to frozen definition allow callback", async () => {
  const f = await fixture(), { state } = await f.authorize();
  await f.update({ ...google, tokenUrl: "https://new.example/token" });
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: "v1" } });
  await f.update(google, "v3");
  const requests = provider(() => ({ json: { refresh_token: "r" } }));
  expect((await completeOAuth(f.ports, { state, code: "c" })).ok).toBe(true);
  expect(requests[0]!.url).toBe(google.tokenUrl);
});

test("concurrent refreshes coalesce, but credential replacement prevents token return and overwrite", async () => {
  const f = await fixture();
  await f.bound();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  let requests = 0;
  globalThis.fetch = (async () => { requests++; started(); await gate; return Response.json({ access_token: "a", expires_in: 3600, refresh_token: "rotated" }); }) as unknown as typeof fetch;
  const first = f.call("secrets.token", f.args), second = f.call("secrets.token", f.args);
  const result = Promise.allSettled([first, second]);
  await entered;
  await f.store.write("mail_google", { clientId: "new", refreshToken: "user" });
  release();
  for (const reply of await result) expect(reply).toMatchObject({ status: "rejected", reason: { code: "unavailable", reason: "reauthorize" } });
  expect(requests).toBe(1);
  expect(await f.store.read("mail_google")).toEqual({ clientId: "new", refreshToken: "user" });
});

for (const changed of ["none", "first", "second"] as const) test(`two modules share one rotating refresh; changed approval: ${changed}`, async () => {
  const f = await fixture();
  await f.bound("work");
  const version = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.module.id, hash: "v1" } } });
  const sibling = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "other", activeHash: "v1" } });
  await f.db.moduleVersion.create({ data: { moduleId: sibling.id, hash: "v1", manifest: { ...moduleManifestSchema.parse(version.manifest), name: "other" }, source: "provider", intent: {}, report: {}, status: "approved" } });
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  let requests = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    requests++;
    expect(new URLSearchParams(String(init.body)).get("refresh_token")).toBe("r-1");
    started();
    await gate;
    return Response.json({ access_token: "shared", expires_in: 3600, refresh_token: "rotated" });
  }) as typeof fetch;
  const args = { ...f.args, account: "work" };
  const result = Promise.allSettled([f.call("secrets.token", args), f.call("secrets.token", args, sibling.id)]);
  await entered;
  if (changed !== "none") await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: changed === "first" ? f.module.id : sibling.id, hash: "v1" } }, data: { status: "pending_review" } });
  release();
  const replies = await result;
  for (const [index, reply] of replies.entries()) {
    if (changed === (index === 0 ? "first" : "second")) expect(reply).toMatchObject({ status: "rejected", reason: { code: "unavailable", reason: "reauthorize" } });
    else expect(reply).toMatchObject({ status: "fulfilled", value: { accessToken: "shared" } });
  }
  expect(requests).toBe(1);
  expect(await f.store.read("mail_google")).toMatchObject({ refreshToken_work: "rotated" });
  // A revoked participant cannot poison the credential or the other module's cached token.
  expect(await f.call("secrets.token", args, changed === "first" ? sibling.id : f.module.id)).toMatchObject({ accessToken: "shared" });
  expect(requests).toBe(1);
});

test("definition changes separate in-flight work and reject late responses from the old endpoint", async () => {
  const f = await fixture();
  await f.bound();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => { urls.push(String(url)); if (String(url) === google.tokenUrl) { started(); await gate; } return Response.json({ access_token: String(url), expires_in: 3600 }); }) as typeof fetch;
  const old = f.call("secrets.token", f.args);
  const oldResult = Promise.allSettled([old]);
  await entered;
  const next = { ...google, tokenUrl: "https://new.example/token" };
  await f.update(next);
  await f.bound("", next);
  expect(await f.call("secrets.token", f.args)).toMatchObject({ accessToken: next.tokenUrl });
  release();
  expect((await oldResult)[0]).toMatchObject({ status: "rejected", reason: { code: "unavailable", reason: "reauthorize" } });
  expect(urls).toEqual([google.tokenUrl, next.tokenUrl]);
});

test("callback rechecks definition after exchange before saving", async () => {
  const f = await fixture(), { state } = await f.authorize();
  globalThis.fetch = (async () => { await f.update({ ...google, tokenUrl: "https://new.example/token" }); return Response.json({ refresh_token: "r" }); }) as unknown as typeof fetch;
  expect((await completeOAuth(f.ports, { state, code: "c" })).ok).toBe(false);
  expect(await f.store.read("mail_google")).not.toHaveProperty("refreshToken");
});

test("denial, missing URL, undeclared scopes/provider and invalid_grant fail explicitly", async () => {
  const f = await fixture();
  await expect(f.call("secrets.authorize", { ...f.args, scopes: ["not-declared"] })).rejects.toMatchObject({ code: "invalid" });
  await expect(f.call("secrets.authorize", { ...f.args, provider: "microsoft", scopes: ["x"] })).rejects.toMatchObject({ code: "forbidden" });
  const { state } = await f.authorize();
  expect(await completeOAuth(f.ports, { state, error: "access_denied" })).toMatchObject({ ok: false, message: "已取消授权。" });
  const missing = await fixture(google, null);
  await expect(missing.authorize()).rejects.toMatchObject({ code: "unavailable" });
  await f.bound();
  provider(() => ({ status: 400, json: { error: "invalid_grant" } }));
  await expect(f.call("secrets.token", f.args)).rejects.toMatchObject({ code: "unavailable", reason: "reauthorize" });
});

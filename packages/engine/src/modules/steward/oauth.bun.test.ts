import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { handleModuleCall } from "./module-effects";
import { completeOAuth, resetOAuth } from "./oauth";
import { createSecrets } from "./secrets";
import { registerSystemModules } from "./system-modules";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";

const cleanups: (() => Promise<unknown>)[] = [];
const realFetch = globalThis.fetch;
afterEach(async () => { globalThis.fetch = realFetch; resetOAuth(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** v2-30 §4: the kernel authorizes and refreshes; modules only see access tokens. */
async function fixture(publicUrl: string | null = "https://chrona.example") {
  registerSystemModules();
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-oauth-"));
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const w = (await db.workspace.create({ data: { name: "oauth" } })).id;
  const ports: StewardPorts = { db, dataDir, now: () => new Date(), publicUrl };
  async function moduleNamed(name: string, part: Record<string, unknown>) {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], ...part });
    const module = await db.module.create({ data: { workspaceId: w, name, activeHash: `${name}-1` } });
    await db.moduleVersion.create({ data: { moduleId: module.id, hash: `${name}-1`, manifest, source: "provider", intent: {}, report: {}, status: "approved" } });
    let id = 0;
    return async (target: string, args: Record<string, string>) => {
      const reply = await handleModuleCall(ports, { workspaceId: w, moduleId: module.id, hash: `${name}-1`, manifest }, { id: String(++id), method: "call", params: { target, args, mode: "sync", reply: false } });
      if ("error" in reply) throw reply.error;
      return (reply as { result: { output: Record<string, any> } }).result.output;
    };
  }
  const store = createSecrets(dataDir);
  return { db, ports, store, mail: await moduleNamed("mail", { effects: ["network"], secrets: ["mail_google"] }), other: await moduleNamed("other", { effects: ["network"], secrets: ["else_oauth"] }) };
}
function provider(replies: (body: URLSearchParams) => { status?: number; json: Record<string, unknown> }) {
  const requests: { url: string; body: URLSearchParams }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = new URLSearchParams(String(init.body)), reply = replies(body);
    requests.push({ url: String(url), body });
    return Response.json(reply.json, { status: reply.status ?? 200 });
  }) as typeof fetch;
  return requests;
}

test("authorize hands out a PKCE link, the callback saves the refresh token once, and token refreshes and caches", async () => {
  const f = await fixture();
  await expect(f.mail("secrets.authorize", { name: "mail_google", provider: "google", scopes: "https://www.googleapis.com/auth/gmail.readonly" })).rejects.toMatchObject({ code: "unavailable" });
  await expect(f.other("secrets.authorize", { name: "mail_google", provider: "google", scopes: "x" })).rejects.toMatchObject({ code: "forbidden" });
  await expect(f.mail("secrets.authorize", { name: "mail_google", provider: "yahoo", scopes: "x" })).rejects.toMatchObject({ code: "invalid" });
  await f.store.write("mail_google", { clientId: "cid", clientSecret: "csecret" });

  const started = await f.mail("secrets.authorize", { name: "mail_google", provider: "google", scopes: "https://www.googleapis.com/auth/gmail.readonly", account: "work" });
  const url = new URL(started.url!);
  expect(started.redirectUri).toBe("https://chrona.example/oauth/callback");
  expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "cid", redirect_uri: started.redirectUri, code_challenge_method: "S256", access_type: "offline", response_type: "code" });
  expect(url.toString()).not.toContain("csecret");

  const requests = provider(body => body.get("grant_type") === "authorization_code"
    ? { json: { refresh_token: "r-1", access_token: "a-0", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.readonly" } }
    : { json: { access_token: "a-1", expires_in: 3600 } });
  expect((await completeOAuth(f.ports, { state: "forged", code: "c" })).ok).toBe(false);
  const state = url.searchParams.get("state")!;
  expect(await completeOAuth(f.ports, { state, code: "c" })).toMatchObject({ ok: true });
  expect((await completeOAuth(f.ports, { state, code: "c" })).ok).toBe(false);
  expect(requests[0]!.body.get("code_verifier")).toBeTruthy();
  expect(await f.store.read("mail_google")).toEqual({ clientId: "cid", clientSecret: "csecret", refreshToken_work: "r-1", scope_work: "https://www.googleapis.com/auth/gmail.readonly", oauthManaged: "1" });
  // The refresh token and client secret stay in the kernel once it manages the credential.
  expect(await f.mail("secrets.get", { name: "mail_google" })).toEqual({ value: { clientId: "cid", scope_work: "https://www.googleapis.com/auth/gmail.readonly", oauthManaged: "1" } });
  expect(await f.db.audit.count({ where: { kind: "secret_set" } })).toBe(1);

  await expect(f.mail("secrets.token", { name: "mail_google", provider: "google" })).rejects.toMatchObject({ code: "reauthorize" });
  expect(await f.mail("secrets.token", { name: "mail_google", provider: "google", account: "work" })).toMatchObject({ accessToken: "a-1" });
  expect(await f.mail("secrets.token", { name: "mail_google", provider: "google", account: "work" })).toMatchObject({ accessToken: "a-1" });
  expect(requests.filter(r => r.body.get("grant_type") === "refresh_token")).toHaveLength(1);
  expect(requests[1]!.body.get("refresh_token")).toBe("r-1");
  await expect(f.other("secrets.token", { name: "mail_google", provider: "google", account: "work" })).rejects.toMatchObject({ code: "forbidden" });
  // Replacing the credential drops the cached token.
  await f.store.write("mail_google", { clientId: "cid2", refreshToken_work: "r-9" });
  await f.mail("secrets.token", { name: "mail_google", provider: "google", account: "work" });
  expect(requests.at(-1)!.body.get("refresh_token")).toBe("r-9");
  expect(requests.at(-1)!.body.has("client_secret")).toBe(false);
});

test("token saves a rotated refresh token and asks to reauthorize on invalid_grant", async () => {
  const f = await fixture();
  await f.store.write("mail_google", { clientId: "cid", refreshToken: "r-1" });
  let revoked = false;
  const requests = provider(body => revoked ? { status: 400, json: { error: "invalid_grant" } }
    : { json: { access_token: `a-${body.get("refresh_token")}`, expires_in: 3600, refresh_token: "r-2" } });
  expect(await f.mail("secrets.token", { name: "mail_google", provider: "microsoft" })).toMatchObject({ accessToken: "a-r-1" });
  expect(requests[0]!.url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
  expect((await f.store.read("mail_google"))!.refreshToken).toBe("r-2");
  expect((await f.mail("secrets.get", { name: "mail_google" })).value).toEqual({ clientId: "cid", oauthManaged: "1" });
  // The rotation itself does not invalidate the token just issued.
  expect(await f.mail("secrets.token", { name: "mail_google", provider: "microsoft" })).toMatchObject({ accessToken: "a-r-1" });
  expect(requests).toHaveLength(1);
  revoked = true;
  resetOAuth();
  await expect(f.mail("secrets.token", { name: "mail_google", provider: "microsoft" })).rejects.toMatchObject({ code: "reauthorize" });
});

test("callback reports denial, expiry and missing public URL without saving", async () => {
  const f = await fixture(null);
  await f.store.write("mail_google", { clientId: "cid" });
  await expect(f.mail("secrets.authorize", { name: "mail_google", provider: "microsoft", scopes: "IMAP.AccessAsUser.All" })).rejects.toMatchObject({ code: "unavailable" });
  const g = await fixture();
  await g.store.write("mail_google", { clientId: "cid" });
  const url = new URL((await g.mail("secrets.authorize", { name: "mail_google", provider: "microsoft", scopes: "IMAP.AccessAsUser.All" })).url!);
  expect(url.searchParams.get("scope")).toBe("IMAP.AccessAsUser.All offline_access");
  expect(await completeOAuth(g.ports, { state: url.searchParams.get("state")!, error: "access_denied" })).toEqual({ ok: false, message: "已取消授权。" });
  expect(await g.store.read("mail_google")).toEqual({ clientId: "cid" });
});

test("legacy credentials stay readable; refreshes are single-flight, keyed by provider, and never overwrite a replaced credential", async () => {
  const f = await fixture();
  await f.store.write("mail_google", { clientId: "cid", clientSecret: "cs", refreshToken: "r-1" });
  // Saved by the user and never written by the kernel: modules that refresh themselves keep working.
  expect((await f.mail("secrets.get", { name: "mail_google" })).value).toEqual({ clientId: "cid", clientSecret: "cs", refreshToken: "r-1" });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requests: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requests.push(String(url));
    await gate;
    return Response.json({ access_token: `a-${requests.length}`, expires_in: 3600, refresh_token: "r-rotated" });
  }) as typeof fetch;
  const both = Promise.all([f.mail("secrets.token", { name: "mail_google", provider: "google" }), f.mail("secrets.token", { name: "mail_google", provider: "google" })]);
  await new Promise(resolve => setTimeout(resolve, 20));
  // The user replaces the credential while the refresh is in flight.
  await f.store.write("mail_google", { clientId: "cid", refreshToken: "r-user" });
  release();
  const [first, second] = await both;
  expect(first.accessToken).toBe(second.accessToken!);
  expect(requests).toHaveLength(1);
  expect(await f.store.read("mail_google")).toEqual({ clientId: "cid", refreshToken: "r-user" });
  // Another provider is a different token, not the cached one.
  const other = await f.mail("secrets.token", { name: "mail_google", provider: "microsoft" });
  expect(requests.at(-1)).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
  expect(other.accessToken).not.toBe(first.accessToken!);
});

test("the page saves field by field, removes one field, and sees declared fields by name only", async () => {
  const f = await fixture();
  const page = await (async () => {
    const manifest = moduleManifestSchema.parse({ name: "web", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: [], uses: ["chat.send", "secrets.set", "secrets.remove", "modules.permissions"] });
    const module = await f.db.module.create({ data: { workspaceId: (await f.db.workspace.findFirstOrThrow()).id, name: "web", activeHash: "page-1" } });
    await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "page-1", manifest, source: "provider", intent: {}, report: {}, status: "approved" } });
    let id = 0;
    return async (target: string, args: Record<string, unknown>) => {
      const reply = await handleModuleCall(f.ports, { workspaceId: module.workspaceId, moduleId: module.id, hash: "page-1", manifest }, { id: String(++id), method: "call", params: { target, args: args as Record<string, string>, mode: "sync", reply: false } });
      if ("error" in reply) throw reply.error;
      return (reply as { result: { output: any } }).result.output;
    };
  })();
  await f.store.write("mail_google", { clientId: "cid", refreshToken: "r", oauthManaged: "1" });
  await page("secrets.set", { name: "mail_google", value: JSON.stringify({ clientSecret: "cs" }), merge: true });
  expect(await f.store.read("mail_google")).toEqual({ clientId: "cid", refreshToken: "r", oauthManaged: "1", clientSecret: "cs" });
  await expect(page("secrets.set", { name: "mail_google", value: JSON.stringify({ refreshToken: "typed" }), merge: true })).rejects.toMatchObject({ code: "invalid" });
  await page("secrets.remove", { name: "mail_google", field: "refreshToken" });
  expect(await f.store.read("mail_google")).toEqual({ clientId: "cid", oauthManaged: "1", clientSecret: "cs" });
  await expect(page("secrets.remove", { name: "mail_google", field: "nope" })).rejects.toMatchObject({ code: "not_found" });
  // Replacing without merge stays available (the command line), and drops what it does not list.
  await page("secrets.set", { name: "mail_google", value: JSON.stringify({ clientId: "c2" }) });
  expect(await f.store.read("mail_google")).toEqual({ clientId: "c2" });

  const declared = moduleManifestSchema.parse({ name: "mailer", entry: "index.ts", tests: ["test.ts"], triggers: [], keepAlive: true, effects: ["network"], secrets: [
    { name: "mail", label: "邮箱密码", extraFields: { label: "账户 id", valueLabel: "授权码" } },
    { name: "mail_google", label: "Gmail", oauth: { provider: "google", scopes: ["https://www.googleapis.com/auth/gmail.readonly"], accounts: true } }] });
  expect(moduleManifestSchema.safeParse({ ...declared, secrets: ["mail", { name: "mail" }] }).success).toBe(false);
  const module = await f.db.module.create({ data: { workspaceId: (await f.db.workspace.findFirstOrThrow()).id, name: "mailer", activeHash: "mailer-1" } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash: "mailer-1", manifest: declared, source: "provider", intent: {}, report: {}, status: "approved" } });
  await f.store.write("mail", { qq: "pw-qq", work: "pw-work" });
  await f.store.write("mail_google", { clientId: "cid", refreshToken_work: "r", scope_work: "s", oauthManaged: "1" });
  const view = await page("modules.permissions", { module: "mailer" });
  expect(view.secrets[0]).toMatchObject({ name: "mail", label: "邮箱密码", configured: true, fields: [], extraFields: { label: "账户 id", saved: ["qq", "work"] }, oauth: null });
  expect(view.secrets[1]).toMatchObject({ name: "mail_google", fields: [{ name: "clientId", saved: true, plain: true }, { name: "clientSecret", saved: false, optional: true }],
    oauth: { provider: "google", accounts: true, authorized: ["work"] } });
  expect(JSON.stringify(view)).not.toContain("pw-qq");
});

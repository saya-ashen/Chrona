import { createHash, randomBytes } from "node:crypto";
import { audit } from "./audit";
import { CallError } from "./module-calls";
import { createSecrets } from "./secrets";
import type { StewardPorts } from "./ports";

/** v2-30 §4: the kernel holds refresh tokens and hands modules short-lived access tokens. Endpoints are fixed here. */
export const OAUTH_PROVIDERS = {
  google: { authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", extra: { access_type: "offline", prompt: "consent" }, scopes: [] as string[] },
  microsoft: { authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", extra: {}, scopes: ["offline_access"] },
} as const;
export type OAuthProvider = keyof typeof OAUTH_PROVIDERS;
export const OAUTH_CALLBACK_PATH = "/oauth/callback";
const ACCOUNT = /^[a-z][a-z0-9_]{0,29}$/, STATE_TTL_MS = 10 * 60_000, MAX_PENDING = 20;

type Pending = { workspaceId: string; name: string; provider: OAuthProvider; account: string | null; verifier: string; redirectUri: string; expires: number };
const pending = new Map<string, Pending>();
const cache = new Map<string, { accessToken: string; expires: number; fingerprint: string }>(), MAX_CACHED = 200;
const refreshing = new Map<string, Promise<{ accessToken: string; expiresAt: string }>>();
/** Set by the kernel when it writes a credential: `secrets.get` then hides the client secret and refresh tokens. */
export const OAUTH_MANAGED = "oauthManaged";
export const hiddenField = (field: string, secret: Record<string, string>) => /^refreshToken_/.test(field) || (!!secret[OAUTH_MANAGED] && /^(refreshToken|clientSecret)$/.test(field));
const locks = new Map<string, Promise<unknown>>();
/** Kernel writes to one credential run one at a time and re-read it first, so a rotation or callback never overwrites a newer value. */
export function locked<T>(name: string, run: () => Promise<T>) {
  const next = (locks.get(name) ?? Promise.resolve()).catch(() => {}).then(run);
  locks.set(name, next);
  void next.finally(() => { if (locks.get(name) === next) locks.delete(name); }).catch(() => {});
  return next;
}

function provider(value: unknown): OAuthProvider {
  if (value !== "google" && value !== "microsoft") throw new CallError("invalid", "provider must be google or microsoft");
  return value;
}
function account(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !ACCOUNT.test(value)) throw new CallError("invalid", "account must be 1-30 lowercase letters, digits or _, starting with a letter");
  return value;
}
const field = (base: string, account: string | null) => account ? `${base}_${account}` : base;
const fingerprint = (secret: Record<string, string>, account: string | null) =>
  createHash("sha256").update(JSON.stringify([secret.clientId, secret.clientSecret ?? "", secret[field("refreshToken", account)]])).digest("hex");

async function post(url: string, body: Record<string, string>, fetcher: typeof fetch) {
  let response: Response;
  try {
    response = await fetcher(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(body), redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch { throw new CallError("unavailable", "OAuth provider unreachable"); }
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { ok: response.ok, data: data && typeof data === "object" ? data : {} };
}

/** Starts an authorization: the URL goes to the user, who consents on the provider's own page. */
export async function authorizeOAuth(ports: StewardPorts, workspaceId: string, args: Record<string, unknown>) {
  const name = String(args.name), chosen = provider(args.provider), who = account(args.account);
  const scopes = [...new Set([...String(args.scopes ?? "").split(/\s+/).filter(Boolean), ...OAUTH_PROVIDERS[chosen].scopes])];
  if (!scopes.length || scopes.some(scope => scope.length > 200 || /[^\x21-\x7e]/.test(scope))) throw new CallError("invalid", "scopes must be space-separated scope names");
  if (!ports.publicUrl) throw new CallError("unavailable", "CHRONA_PUBLIC_URL is not set: the provider needs a redirect address");
  const secret = await createSecrets(ports.dataDir).read(name);
  if (!secret?.clientId) throw new CallError("unavailable", `Save clientId (and clientSecret) in Settings → Credentials → ${name} first`);
  const now = Date.now();
  for (const [state, entry] of pending) if (entry.expires <= now) pending.delete(state);
  if (pending.size >= MAX_PENDING) throw new CallError("conflict", "Too many authorizations in progress; finish or wait 10 minutes");
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
  const redirectUri = `${ports.publicUrl.replace(/\/$/, "")}${OAUTH_CALLBACK_PATH}`;
  pending.set(state, { workspaceId, name, provider: chosen, account: who, verifier, redirectUri, expires: now + STATE_TTL_MS });
  const url = new URL(OAUTH_PROVIDERS[chosen].authorize);
  for (const [key, value] of Object.entries({ response_type: "code", client_id: secret.clientId, redirect_uri: redirectUri, scope: scopes.join(" "), state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", ...OAUTH_PROVIDERS[chosen].extra })) url.searchParams.set(key, value);
  return { url: url.href, redirectUri, expiresAt: new Date(now + STATE_TTL_MS).toISOString() };
}

/** The provider's redirect back (unauthenticated: the one-time state identifies the request). Returns a sentence for the page. */
export async function completeOAuth(ports: StewardPorts, query: Record<string, string | undefined>, fetcher: typeof fetch = fetch) {
  const entry = query.state ? pending.get(query.state) : undefined;
  if (query.state) pending.delete(query.state);
  if (!entry || entry.expires <= Date.now()) return { ok: false, message: "授权链接无效或已过期，请重新发起授权。" };
  if (query.error) return { ok: false, message: query.error === "access_denied" ? "已取消授权。" : "提供方拒绝了授权，请检查应用设置后重试。" };
  if (!query.code) return { ok: false, message: "回调缺少授权码，请重新发起授权。" };
  const store = createSecrets(ports.dataDir), secret = await store.read(entry.name);
  if (!secret?.clientId) return { ok: false, message: "凭据已被删除，请重新填写后授权。" };
  const result = await post(OAUTH_PROVIDERS[entry.provider].token, { grant_type: "authorization_code", code: query.code, redirect_uri: entry.redirectUri,
    client_id: secret.clientId, code_verifier: entry.verifier, ...(secret.clientSecret ? { client_secret: secret.clientSecret } : {}) }, fetcher).catch(() => null);
  const refresh = result?.data.refresh_token;
  if (!result?.ok || typeof refresh !== "string" || !refresh || refresh.length > 8192) return { ok: false, message: "换取令牌失败，请确认回调地址已在应用中登记后重试。" };
  const scope = typeof result.data.scope === "string" ? result.data.scope.slice(0, 2000) : "";
  const saved = await locked(entry.name, async () => {
    const current = await store.read(entry.name);
    // Replaced with another app or deleted while the user was consenting: the code belongs to the old one.
    if (!current || current.clientId !== secret.clientId) return false;
    await store.write(entry.name, { ...current, [field("refreshToken", entry.account)]: refresh, ...(scope ? { [field("scope", entry.account)]: scope } : {}), [OAUTH_MANAGED]: "1" });
    return true;
  });
  if (!saved) return { ok: false, message: "凭据在授权期间被更换或删除，请重新发起授权。" };
  await audit(ports.db, { workspaceId: entry.workspaceId, actor: "user", kind: "secret_set", subjectId: null, details: { name: entry.name } });
  return { ok: true, message: `已授权 ${entry.name}${entry.account ? `（${entry.account}）` : ""}，可以关闭此页。` };
}

/** A current access token; refreshes when within a minute of expiry and saves a rotated refresh token. */
export async function oauthToken(ports: StewardPorts, args: Record<string, unknown>, fetcher: typeof fetch = fetch) {
  const name = String(args.name), chosen = provider(args.provider), who = account(args.account), key = `${ports.dataDir}\0${name}\0${who ?? ""}\0${chosen}`;
  const running = refreshing.get(key);
  if (running) return running;
  const work = refresh(ports, name, chosen, who, key, fetcher).finally(() => refreshing.delete(key));
  refreshing.set(key, work);
  return work;
}
async function refresh(ports: StewardPorts, name: string, chosen: OAuthProvider, who: string | null, key: string, fetcher: typeof fetch) {
  const store = createSecrets(ports.dataDir), secret = await store.read(name);
  const refresh = secret?.[field("refreshToken", who)];
  if (!secret?.clientId || !refresh) throw new CallError("reauthorize", `${name} is not authorized${who ? ` for ${who}` : ""}: call secrets.authorize and give the user the link`);
  const print = fingerprint(secret, who), cached = cache.get(key);
  if (cached && cached.fingerprint === print && cached.expires - 60_000 > Date.now()) return { accessToken: cached.accessToken, expiresAt: new Date(cached.expires).toISOString() };
  const result = await post(OAUTH_PROVIDERS[chosen].token, { grant_type: "refresh_token", refresh_token: refresh, client_id: secret.clientId,
    ...(secret.clientSecret ? { client_secret: secret.clientSecret } : {}) }, fetcher);
  if (!result.ok) {
    cache.delete(key);
    if (result.data.error === "invalid_grant") throw new CallError("reauthorize", `${name} authorization was revoked or expired: call secrets.authorize and give the user the link`);
    throw new CallError("unavailable", "OAuth provider refused the refresh");
  }
  const { access_token: accessToken, expires_in: expiresIn, refresh_token: rotated } = result.data;
  if (typeof accessToken !== "string" || !accessToken || accessToken.length > 16384 || typeof expiresIn !== "number" || !(expiresIn > 60)) throw new CallError("unavailable", "OAuth provider returned an invalid token");
  let saved = secret;
  if (typeof rotated === "string" && rotated && rotated !== refresh && rotated.length <= 8192) {
    saved = await locked(name, async () => {
      const current = await store.read(name);
      // Changed meanwhile (the user replaced it, or it was deleted): keep theirs.
      if (!current || fingerprint(current, who) !== print) return current ?? secret;
      const next = { ...current, [field("refreshToken", who)]: rotated, [OAUTH_MANAGED]: "1" };
      await store.write(name, next);
      return next;
    });
  }
  const now = Date.now(), expires = now + Math.min(expiresIn, 86_400) * 1000;
  for (const [stale, entry] of cache) if (entry.expires <= now) cache.delete(stale);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(key, { accessToken, expires, fingerprint: fingerprint(saved, who) });
  return { accessToken, expiresAt: new Date(expires).toISOString() };
}

/** Tests only. */
export function resetOAuth() { pending.clear(); cache.clear(); refreshing.clear(); }

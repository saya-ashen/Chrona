import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { chmod, lstat, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { assertPrivateStoragePath, ensurePrivateDirectory, secureGeneratedPrivateFile } from "@chrona/db/sqlite-url";
import { z } from "zod";

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MAX_SESSIONS = 32;
const MAX_STATE_BYTES = 16 * 1024;
const passwordHashSchema = z.string().regex(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
const stateSchema = z.object({
  version: z.literal(1),
  passwordHash: passwordHashSchema.nullable(),
  sessions: z.array(z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int().positive() }).strict()).max(MAX_SESSIONS),
}).strict();
type State = z.infer<typeof stateSchema>;

export class BrowserAuthError extends Error {
  constructor(readonly status: 401 | 409 | 429, message: string) { super(message); }
}
function derive(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key));
  });
}
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
async function verifyPassword(password: string, hash: string) {
  const [, salt, expected] = hash.split("$");
  return timingSafeEqual(await derive(password, salt!), Buffer.from(expected!, "hex"));
}
function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

async function existingInfo(path: string) {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return null; }
}
async function syncDirectory(path: string) {
  // Windows cannot open directories for fsync this way.
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
async function ensureDurableDirectory(path: string) {
  const missing: string[] = [];
  if (process.platform !== "win32") {
    for (let current = path; !await existingInfo(current); current = dirname(current)) missing.push(current);
  }
  ensurePrivateDirectory(path);
  // A flushed state file cannot survive a crash if its newly created ancestors disappear.
  for (const created of missing.reverse()) await syncDirectory(dirname(created));
}
async function privateDirectory(path: string) {
  const info = await existingInfo(path);
  if (info && !info.isDirectory()) throw new Error("Unsafe browser authentication directory");
  await ensureDurableDirectory(path);
  if (await realpath(path) !== path) throw new Error("Unsafe browser authentication directory");
  if (process.platform !== "win32") await chmod(path, 0o700);
}
function assertSafeState(info: Stats) {
  if (!info.isFile() || info.nlink !== 1 || info.size > MAX_STATE_BYTES) throw new Error("Unsafe browser authentication state file");
}
async function readState(file: string): Promise<State> {
  const info = await existingInfo(file);
  if (!info) return { version: 1, passwordHash: null, sessions: [] };
  assertSafeState(info);
  assertPrivateStoragePath(file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    assertSafeState(opened);
    if (info.dev !== opened.dev || info.ino !== opened.ino) throw new Error("Unsafe browser authentication state file");
    if (process.platform !== "win32") await handle.chmod(0o600);
    // Bound the read as well as stat: a file could grow after it was inspected.
    const bytes = Buffer.alloc(MAX_STATE_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_STATE_BYTES) throw new Error("Unsafe browser authentication state file");
    const parsed = stateSchema.safeParse(JSON.parse(bytes.subarray(0, size).toString("utf8")));
    if (!parsed.success || (!parsed.data.passwordHash && parsed.data.sessions.length)) throw new Error("Invalid browser authentication state");
    return parsed.data;
  } finally { await handle.close(); }
}

/** One store per server. All mutations, including password verification, share a bounded queue. */
export async function createBrowserAuthStore(dataDir: string, now: () => number) {
  const root = resolve(dataDir), secrets = join(root, "secrets"), directory = join(secrets, "browser-auth"), file = join(directory, "state.json");
  async function prepareDirectory() {
    // Never chmod an arbitrary data root; only the dedicated secrets directories are private.
    await ensureDurableDirectory(root);
    if (await realpath(root) !== root) throw new Error("Unsafe browser authentication data directory");
    await privateDirectory(secrets);
    await privateDirectory(directory);
  }
  await prepareDirectory();
  let state = await readState(file);

  let tail: Promise<unknown> = Promise.resolve(), pending = 0;
  function serialized<T>(action: () => Promise<T>): Promise<T> {
    if (pending >= 8) return Promise.reject(new BrowserAuthError(429, "Authentication is busy; try again later"));
    pending++;
    const result = tail.then(action).finally(() => { pending--; });
    tail = result.catch(() => {});
    return result;
  }
  async function save(next: State) {
    await prepareDirectory();
    const existing = await existingInfo(file);
    if (existing) assertSafeState(existing);
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { secureGeneratedPrivateFile(temporary); await handle.writeFile(JSON.stringify(next)); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, file);
      state = next;
      await syncDirectory(directory);
    } finally { await rm(temporary, { force: true }); }
  }
  function authenticated(token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const hash = tokenHash(token);
    return state.sessions.some(session => session.hash === hash && session.expiresAt > now());
  }
  async function issue(passwordHash: string, revokeAll: boolean) {
    const token = randomBytes(32).toString("base64url"), time = now();
    const sessions = revokeAll ? [] : state.sessions.filter(session => session.expiresAt > time).slice(-(MAX_SESSIONS - 1));
    sessions.push({ hash: tokenHash(token), expiresAt: time + SESSION_MAX_AGE_SECONDS * 1000 });
    await save({ version: 1, passwordHash, sessions });
    return token;
  }
  return {
    passwordSet: () => state.passwordHash !== null,
    authenticated,
    setup: (password: string) => serialized(async () => {
      if (state.passwordHash) throw new BrowserAuthError(409, "A browser password is already configured");
      return issue(await hashPassword(password), true);
    }),
    login: (password: string) => serialized(async () => {
      if (!state.passwordHash || !await verifyPassword(password, state.passwordHash)) throw new BrowserAuthError(401, "Invalid password");
      return issue(state.passwordHash, false);
    }),
    change: (token: string | undefined, currentPassword: string, password: string) => serialized(async () => {
      // Recheck inside the queue: another change/logout may have revoked the caller while it waited.
      if (!authenticated(token) || !state.passwordHash || !await verifyPassword(currentPassword, state.passwordHash)) throw new BrowserAuthError(401, "Invalid session or current password");
      return issue(await hashPassword(password), true);
    }),
    logout: (token: string | undefined) => serialized(async () => {
      if (!authenticated(token)) return;
      await save({ ...state, sessions: state.sessions.filter(session => session.hash !== tokenHash(token!) && session.expiresAt > now()) });
    }),
  };
}

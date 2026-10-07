import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { getChronaDataDir } from "@chrona/shared";
import { ProviderOperationError } from "@chrona/providers-foundation";
import type { PiClientConfig } from "@chrona/contracts";
import { PI_BRIDGE_SOURCE } from "./bridge-source";
import { record } from "./rpc";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function expandPath(value: string) {
  return resolve(value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value);
}

export type PiSession = { id: string; file: string; model: string };

export class PiState {
  readonly root: string;
  readonly cwd: string;
  readonly agentDir: string;
  readonly binaryPath: string;

  constructor(readonly config: PiClientConfig, stateDirectory?: string) {
    this.binaryPath = config.binaryPath?.trim() || "pi";
    this.cwd = expandPath(config.cwd?.trim() || process.cwd());
    this.agentDir = expandPath(config.codingAgentDirectory?.trim() || process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
    const scope = createHash("sha256").update(JSON.stringify([this.cwd, this.agentDir, this.binaryPath])).digest("hex").slice(0, 24);
    this.root = join(stateDirectory ?? join(getChronaDataDir(), "providers", "pi"), scope);
  }

  async initialize() {
    for (const directory of [this.root, join(this.root, "sessions"), join(this.root, "refs"), join(this.root, "operations"), join(this.root, "locks")]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if ((await lstat(directory)).isSymbolicLink()) throw new Error("Pi state directories must not be symlinks");
    }
    const bridge = join(this.root, "bridge.mjs");
    // Versioned contents keep concurrent launches independent from later code updates.
    const version = createHash("sha256").update(PI_BRIDGE_SOURCE).digest("hex").slice(0, 16);
    const file = bridge.replace(".mjs", `-${version}.mjs`);
    try { await writeFile(file, PI_BRIDGE_SOURCE, { flag: "wx", mode: 0o600 }); }
    catch (error) { if (record(error).code !== "EEXIST") throw error; }
    if ((await lstat(file)).isSymbolicLink()) throw new Error("Pi bridge must not be a symlink");
    return file;
  }

  async claimOperation(operationId: string) {
    const hash = createHash("sha256").update(operationId).digest("hex");
    const file = join(this.root, "operations", `${hash}.json`);
    try {
      const handle = await open(file, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify({ createdAt: new Date().toISOString() })); await handle.sync(); }
      finally { await handle.close(); }
    } catch (error) {
      if (record(error).code !== "EEXIST") throw error;
      throw new ProviderOperationError({ provider: "pi", code: "provider_start_outcome_unknown", message: "This Pi operation was already started. Chrona will not replay it; start a new operation explicitly." });
    }
  }

  newSessionPath() { return join(this.root, "sessions", `${randomUUID()}.jsonl`); }

  async saveSession(id: string, file: string, model: string) {
    if (!UUID.test(id) || resolve(file) !== file || dirname(file) !== join(this.root, "sessions") || !UUID.test(basename(file, ".jsonl"))) {
      throw new Error("Pi returned an unowned session identity");
    }
    const ref = join(this.root, "refs", `${id}.json`);
    const data = JSON.stringify({ id, file, model });
    try { await writeFile(ref, data, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (record(error).code !== "EEXIST") throw error;
      const existing = await this.loadSession(id);
      if (existing.file !== file || existing.model !== model) throw new Error("Pi session identity changed unexpectedly", { cause: error });
    }
  }

  async loadSession(id: string): Promise<PiSession> {
    if (!UUID.test(id)) throw new Error("Pi session reference is not owned by Chrona");
    const ref = join(this.root, "refs", `${id}.json`);
    const stat = await lstat(ref);
    if (!stat.isFile() || stat.size > 4096) throw new Error("Invalid Pi session reference");
    const value = record(JSON.parse(await readFile(ref, "utf8")));
    if (value.id !== id || typeof value.file !== "string" || typeof value.model !== "string") throw new Error("Invalid Pi session reference");
    const file = value.file;
    const directory = await realpath(join(this.root, "sessions"));
    if (!UUID.test(basename(file, ".jsonl")) || resolve(file) !== join(directory, basename(file))) throw new Error("Pi session is outside Chrona storage");
    if (!(await lstat(file)).isFile() || await realpath(file) !== file) throw new Error("Pi session is unavailable or unsafe");
    return { id, file, model: value.model };
  }

  async lockSession(file: string) {
    const key = createHash("sha256").update(file).digest("hex");
    const lock = join(this.root, "locks", key);
    let handle;
    try { handle = await open(lock, "wx", 0o600); }
    catch { throw new Error("Pi session is locked by another or interrupted operation. Start with fresh context rather than replaying it."); }
    await handle.close();
    return async () => { await unlink(lock).catch(() => undefined); };
  }
}

import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readFile as readBytes, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { affairPathSchema, type FileContent, type FileNode, type Revision } from "@chrona/contracts/steward";
import { appendCsvRow, toggleCheckbox as toggleMarkdown } from "@chrona/domain/steward/markdown";
import type { ToolSpec } from "@chrona/domain/steward/tool-spec";
import { parseInput, StewardError } from "./errors";

export type FileAuthor = "user" | "chrona";
const locks = new Map<string, Promise<void>>();
const MAX_UPLOAD = 20 * 1024 * 1024;
async function locked<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(done => { release = done; });
  locks.set(key, current);
  await previous;
  try { return await action(); }
  finally { release(); if (locks.get(key) === current) locks.delete(key); }
}
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
function safePath(value: string): string {
  const path = parseInput(affairPathSchema, value);
  if (path !== value || path.includes("\\") || path.includes("\0") || path.split("/").includes(".") || path === ".chrona/sessions" || path.startsWith(".chrona/sessions/")) throw new StewardError("invalid", "Reserved or invalid path");
  return path;
}
function guardProviderWrite(path: string, author: FileAuthor) {
  if (author === "chrona" && path.startsWith(".chrona/")) throw new StewardError("forbidden", "Chrona metadata is engine-owned");
}
function safeDir(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new StewardError("invalid", "Invalid affair directory");
  return value;
}
const identity = (author: FileAuthor) => author === "user" ? { name: "你", email: "user@local" } : { name: "Chrona", email: "chrona@local" };

/** One process-wide mutex per canonical affair directory. Provider writes must be quiescent
 * while committing/reverting; the runtime owns that coordination (V3). Symlinks are never
 * traversed, including ones pointing back inside the affair, and special files are rejected. */
function createWorkspaceRoots(dataDir: string) {
  const dataRoot = resolve(dataDir);
  const affairsRoot = join(dataRoot, "affairs");
  async function roots() {
    await mkdir(dataRoot, { recursive: true });
    if ((await lstat(dataRoot)).isSymbolicLink() || await realpath(dataRoot) !== dataRoot) throw new StewardError("forbidden", "Symlink data directory");
    await mkdir(affairsRoot, { recursive: true });
    if ((await lstat(affairsRoot)).isSymbolicLink() || await realpath(affairsRoot) !== affairsRoot) throw new StewardError("forbidden", "Symlink affairs directory");
  }
  async function root(dirName: string) {
    await roots();
    const dir = join(affairsRoot, safeDir(dirName));
    const info = await lstat(dir);
    if (!info.isDirectory() || await realpath(dir) !== dir) throw new StewardError("forbidden", "Invalid affair directory");
    return dir;
  }
  return { roots, root, affairsRoot };
}

function assertSafeFile(info: Awaited<ReturnType<typeof lstat>>, canonical: string, dir: string) {
  if (info.isSymbolicLink() || !canonical.startsWith(dir + sep) || (!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink > 1)) throw new StewardError("forbidden", "Unsafe file path");
}

async function confined(dir: string, path: string, createParents = false) {
    const parts = safePath(path).split("/");
    let current = dir;
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]!);
      let info;
      try { info = await lstat(current); }
      catch (error) {
        if (!missing(error)) throw error;
        if (i === parts.length - 1) return current;
        if (!createParents) return join(dir, ...parts);
        await mkdir(current);
        info = await lstat(current);
      }
      const canonical = await realpath(current);
      assertSafeFile(info, canonical, dir);
      if (i < parts.length - 1 && !info.isDirectory()) throw new StewardError("invalid", "Not a directory");
    }
    return current;
  }
  async function checkGitMetadata(dir: string) {
    const metadata = join(dir, ".git");
    if (!(await lstat(metadata)).isDirectory() || await realpath(metadata) !== metadata) throw new StewardError("forbidden", "Invalid git directory");
    const walk = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        const info = await lstat(path);
        if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.isFile() && info.nlink !== 1)) throw new StewardError("forbidden", "Unsafe git metadata");
        if (info.isDirectory()) await walk(path);
      }
    };
    await walk(metadata);
    for (const path of ["commondir", "objects/info/alternates", "objects/info/http-alternates"]) {
      try { await lstat(join(metadata, path)); } catch (error) { if (missing(error)) continue; throw error; }
      throw new StewardError("forbidden", "External git object stores are not allowed");
    }
    await checkGitConfig(metadata);
  }
  async function checkGitConfig(metadata: string) {
    // The repository is engine-owned. Reject config includes, external filters, worktrees,
    // and command-valued settings rather than letting git read/execute them first.
    let section = "";
    for (const line of (await readBytes(join(metadata, "config"), "utf8")).split(/\r?\n/)) {
      const value = line.trim();
      if (!value || value.startsWith("#") || value.startsWith(";")) continue;
      if (/^\[(core|user)\]$/.test(value)) { section = value.slice(1, -1); continue; }
      if (section === "core" && /^(repositoryformatversion\s*=\s*0|filemode\s*=\s*(true|false)|bare\s*=\s*false|logallrefupdates\s*=\s*(true|false))$/i.test(value)) continue;
      if (section === "user" && /^(name|email)\s*=[^\r\n]*$/i.test(value)) continue;
      throw new StewardError("forbidden", "Untrusted git configuration");
    }
  }
  async function git(dir: string, args: string[], author: FileAuthor = "chrona") {
    if (args[0] !== "init") await checkGitMetadata(dir);
    const who = identity(author);
    // Auto-maintenance may detach and prune objects after git exits, racing the
    // next metadata validation even though our foreground operations serialize.
    const process = Bun.spawn(["git", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", "-c", "core.fsmonitor=false", ...args], {
      cwd: dir, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { PATH: Bun.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8", HOME: dir,
        GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_ATTR_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1",
        GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email },
    });
    const [out, err, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    if (exit !== 0) throw new StewardError("conflict", `Git ${args[0]} failed: ${err.slice(0, 500)}`);
    return out;
  }
  async function revision(dir: string, path: string) {
    return (await git(dir, ["log", "-1", "--format=%H", "--", safePath(path)])).trim() || null;
  }
  async function readFile(dir: string, path: string): Promise<FileContent> {
    const target = await confined(dir, path);
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new StewardError("invalid", "Not a regular file");
      const bytes = await handle.readFile();
      const mime = Bun.file(target).type || "application/octet-stream";
      let content = "";
      try { if ((mime.startsWith("text/") || /(?:json|xml|javascript|yaml)/.test(mime) || mime === "application/octet-stream") && !bytes.includes(0)) content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* Binary content is downloaded, not rendered. */ }
      return { path: safePath(path), content, mime, revision: await revision(dir, path), updatedAt: info.mtime.toISOString() };
    } finally { await handle.close(); }
  }
  async function writeFile(dir: string, path: string, content: string | Uint8Array, exclusive = false) {
    const target = await confined(dir, path, true);
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (exclusive ? constants.O_EXCL : 0), 0o644);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1) throw new StewardError("forbidden", "Not a safe regular file");
      await handle.truncate(0);
      await handle.writeFile(content);
    } finally { await handle.close(); }
  }
  async function commit(dir: string, author: FileAuthor, message: string, paths?: string[]) {
    await git(dir, ["add", "-A", "--", ...(paths ?? ["."])]);
    const changed = (await git(dir, ["diff", "--cached", "--name-only", "-z", "--no-renames"])).split("\0").filter(Boolean);
    const selected = paths ? changed.filter(path => paths.includes(path)) : changed;
    if (selected.length) await git(dir, ["commit", "-q", "-m", message, ...(paths ? ["--only", "--", ...paths] : [])], author);
    return selected;
  }
  async function checkBase(dir: string, path: string, base: string | null) {
    if (await revision(dir, path) !== base) throw new StewardError("conflict", "File changed since base revision");
    // Do not overwrite Provider changes that have not been committed yet.
    if (base !== null && (await git(dir, ["status", "--porcelain", "--", safePath(path)])).trim()) throw new StewardError("conflict", "File has uncommitted changes");
    if (base === null) {
      try { await lstat(await confined(dir, path)); } catch (error) { if (missing(error)) return; throw error; }
      throw new StewardError("conflict", "File already exists");
    }
  }
  async function revisionsAt(dir: string, path?: string): Promise<Revision[]> {
    if (path !== undefined) await confined(dir, path);
    const shas = (await git(dir, ["log", "-100", "--format=%H", ...(path ? ["--", safePath(path)] : [])])).trim().split("\n").filter(Boolean);
    return Promise.all(shas.map(async sha => {
      const [email, at, ...message] = (await git(dir, ["show", "-s", "--format=%ae%n%aI%n%B", sha])).trimEnd().split("\n");
      const paths = (await git(dir, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", sha])).split("\0").filter(Boolean).slice(0, 200);
      return { sha, author: email === "user@local" ? "user" : "chrona", at: new Date(at!).toISOString(), message: message.join("\n").slice(0, 500), paths };
    }));
  }
export async function snapshotModule(dir: string, path: string) {
  const result: { path: string; bytes: Uint8Array }[] = [];
  let total = 0;
  const walk = async (relative: string, prefix: string): Promise<void> => {
    const target = await confined(dir, relative), info = await lstat(target);
    if (info.isDirectory()) {
      for (const entry of await readdir(target)) await walk(`${relative}/${entry}`, prefix ? `${prefix}/${entry}` : entry);
    } else {
      if (result.length >= 200 || total + info.size > 1024 * 1024) throw new StewardError("invalid", "Module exceeds file limits");
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1) throw new StewardError("forbidden", "Unsafe module file");
        const buffer = Buffer.alloc(1024 * 1024 - total + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        total += length;
        if (total > 1024 * 1024) throw new StewardError("invalid", "Module exceeds file limits");
        result.push({ path: prefix, bytes: buffer.subarray(0, length) });
      } finally { await handle.close(); }
    }
  };
  const target = await confined(dir, path);
  if (!(await lstat(target)).isDirectory()) throw new StewardError("invalid", "Module must be a directory");
  await walk(path, "");
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function affairFiles(affairsRoot: string, root: (dirName: string) => Promise<string>, dirName: string) {
    safeDir(dirName);
    const run = <T>(action: (dir: string) => Promise<T>) => locked(join(affairsRoot, dirName), async () => action(await root(dirName)));
    return {
      /** Bounded, no-follow snapshot for the module gateway; never traverse git metadata. */
      snapshotModule: (path: string) => run(dir => snapshotModule(dir, path)),
      checkoutModule: (path: string, files: { path: string; bytes: Uint8Array }[]) => run(async dir => {
        const target = await confined(dir, path, true);
        try {
          if (!(await lstat(target)).isDirectory() || (await readdir(target)).length) throw new StewardError("conflict", "Checkout directory must be empty");
        } catch (error) { if (!missing(error)) throw error; await mkdir(target); }
        for (const file of files) await writeFile(dir, `${path}/${safePath(file.path)}`, file.bytes, true);
        await commit(dir, "chrona", `Checkout module ${path}`, files.map(file => `${path}/${file.path}`));
      }),
      /** Absolute cwd for a trusted Provider runtime; not a user-controlled path. */
      directory: () => run(async dir => dir),
      tree: (directory = "") => run(async dir => {
        const result: FileNode[] = [];
        const walk = async (relative: string) => {
          const folder = relative ? await confined(dir, relative) : dir;
          for (const entry of await readdir(folder, { withFileTypes: true })) {
            const path = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.name === ".git" || path === ".chrona/sessions") continue;
            // Hide symlinks rather than exposing their targets in the tree.
            if (entry.isSymbolicLink()) continue;
            const target = await confined(dir, path);
            const info = await lstat(target);
            result.push({ path, kind: info.isDirectory() ? "dir" : "file", size: info.size, updatedAt: info.mtime.toISOString() });
            if (info.isDirectory()) await walk(path);
          }
        };
        await walk(directory ? safePath(directory) : "");
        return result.sort((a, b) => a.path.localeCompare(b.path));
      }),
      read: (path: string) => run(dir => readFile(dir, path)),
      /** Engine UI tool only; changes are committed with the Provider run. */
      writeUi: (path: string, content: string, role: "page" | "entry" | "card") => run(async dir => {
        if (path.startsWith(".chrona") || !path.endsWith(".ui.json")) throw new StewardError("invalid", "Invalid UI page path");
        // The Today card is metadata, not a page of the affair: keep it out of the page list.
        if (role === "card") { await writeFile(dir, ".chrona/card.ui.json", content); return; }
        await writeFile(dir, path, content);
        if (role === "entry") await writeFile(dir, ".chrona/entry", path + "\n");
      }),
      /** Raw download uses the same confinement and no-follow boundary as text reads. */
      raw: (path: string) => run(async dir => {
        const target = await confined(dir, path);
        const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.nlink !== 1) throw new StewardError("forbidden", "Unsafe file path");
          return new Uint8Array(await handle.readFile());
        } finally { await handle.close(); }
      }),
      save: (path: string, content: string, baseRevision: string | null, author: FileAuthor = "user") => run(async dir => {
        guardProviderWrite(path, author);
        await confined(dir, path); await checkBase(dir, path, baseRevision);
        await writeFile(dir, path, content); await commit(dir, author, `Edit ${path}`, [path]);
        return readFile(dir, path);
      }),
      toggleCheckbox: (path: string, line: number, checked: boolean, baseRevision: string | null, author: FileAuthor = "user") => run(async dir => {
        guardProviderWrite(path, author);
        await confined(dir, path); await checkBase(dir, path, baseRevision);
        const file = await readFile(dir, path);
        await writeFile(dir, path, toggleMarkdown(file.content, line, checked));
        await commit(dir, author, `Toggle ${path}:${line}`, [path]); return readFile(dir, path);
      }),
      /** Caller obtains fields from parsePanelBlocks(page); domain validates every value. */
      appendPanelEntry: (path: string, fields: ToolSpec["fields"], values: unknown, author: FileAuthor = "user") => run(async dir => {
        guardProviderWrite(path, author);
        let csv = "";
        try { csv = (await readFile(dir, path)).content; } catch (error) { if (!missing(error)) throw error; }
        await writeFile(dir, path, appendCsvRow(csv, fields, values));
        await commit(dir, author, `Append ${path}`, [path]); return readFile(dir, path);
      }),
      upload: (directory: string, name: string, bytes: Uint8Array) => run(async dir => {
        if (bytes.byteLength > MAX_UPLOAD) throw new StewardError("invalid", "Upload exceeds 20 MB");
        const clean = name.normalize("NFKC").replaceAll("\\", "/").split("/").pop()!.replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "").slice(0, 180);
        if (!clean) throw new StewardError("invalid", "Invalid upload name");
        const path = directory ? `${safePath(directory)}/${clean}` : clean;
        await writeFile(dir, path, bytes, true); await commit(dir, "user", `Upload ${path}`, [path]);
        const info = await lstat(await confined(dir, path));
        return { path, kind: "file" as const, size: info.size, updatedAt: info.mtime.toISOString() };
      }),
      /** Trusted connector intake; same confinement as user writes, one Chrona commit. */
      intake: (files: { path: string; bytes: Uint8Array }[], message: string) => run(async dir => {
        for (const file of files) await writeFile(dir, file.path, file.bytes);
        await commit(dir, "chrona", message, files.map(file => file.path));
      }),
      revisions: (path?: string) => run(dir => revisionsAt(dir, path)),
      diff: (sha: string) => run(async dir => {
        if (!/^[a-f0-9]{40}$/.test(sha)) throw new StewardError("invalid", "Invalid revision");
        return git(dir, ["show", "--format=fuller", "--no-ext-diff", "--no-textconv", sha, "--"]);
      }),
      revert: (sha: string) => run(async dir => {
        if (!/^[a-f0-9]{40}$/.test(sha)) throw new StewardError("invalid", "Invalid revision");
        if ((await git(dir, ["status", "--porcelain"])).trim()) throw new StewardError("conflict", "Commit pending changes before reverting");
        try { await git(dir, ["revert", "--no-edit", sha], "user"); }
        catch (error) { await git(dir, ["revert", "--abort"], "user").catch(() => undefined); throw error; }
        return (await revisionsAt(dir))[0]!;
      }),
      commitAll: (author: FileAuthor, message: string) => run(dir => commit(dir, author, message)),
    };
  }

export function createWorkspaceFs(dataDir: string) {
  const { roots, root, affairsRoot } = createWorkspaceRoots(dataDir);
  const forAffair = (dirName: string) => affairFiles(affairsRoot, root, dirName);
  return {
    forAffair,
    /** Non-affair chat intake: deliberately no git repo, under the Provider workspace cwd. */
    async uploadChatInbox(path: string, bytes: Uint8Array) {
      if (!path.startsWith("inbox/chat/") || bytes.byteLength > MAX_UPLOAD) throw new StewardError("invalid", "Invalid chat upload");
      return locked(affairsRoot, async () => {
        await roots();
        await writeFile(affairsRoot, path, bytes, true);
        return path;
      });
    },
    async createAffairDir(dirName: string, readme: string) {
      safeDir(dirName);
      return locked(join(affairsRoot, dirName), async () => {
        await roots();
        const dir = join(affairsRoot, dirName);
        await mkdir(dir); // Never adopt an existing directory/repository.
        await git(dir, ["init", "-q", "--template="]);
        await git(dir, ["config", "--local", "user.name", "Chrona"]);
        await git(dir, ["config", "--local", "user.email", "chrona@local"]);
        await writeFile(dir, "README.md", readme);
        await writeFile(dir, ".chrona/.gitignore", "sessions/\n");
        await commit(dir, "chrona", "Create affair");
        return forAffair(dirName);
      });
    },
  };
}
export type WorkspaceFs = ReturnType<typeof createWorkspaceFs>;
export type AffairFs = ReturnType<WorkspaceFs["forAffair"]>;

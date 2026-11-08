import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { CallError, type StewardPorts } from "@chrona/engine";
import type { ExecutionPrincipal, ExecutionProjectGrant } from "@chrona/contracts/steward";

const exec = promisify(execFile);
const rowSchema = z.object({ workspaceId: z.string(), ownerId: z.string(), callerKey: z.string(), projectRef: z.string(), path: z.string(), label: z.string(), identity: z.string() }).strict();
const defaultSchema = rowSchema.pick({ workspaceId: true, ownerId: true, callerKey: true, projectRef: true });
const registrySchema = z.object({ version: z.literal(1), projects: z.array(rowSchema).max(100), defaults: z.array(defaultSchema).max(100).default([]) }).strict();
type Registry = z.infer<typeof registrySchema>;
type Row = z.infer<typeof rowSchema>;
const key = (principal: ExecutionPrincipal) => principal.caller.kind === "owner" ? "owner" : `module:${principal.caller.moduleId}`;
const matches = (row: z.infer<typeof defaultSchema>, principal: ExecutionPrincipal) => row.workspaceId === principal.workspaceId && row.ownerId === principal.ownerId && row.callerKey === key(principal);
const view = ({ projectRef, path, label }: Row) => ({ projectRef, path, label });
async function directory(path: string) {
  if (!isAbsolute(path)) throw new CallError("invalid", "请输入 Chrona 所在主机的绝对目录路径。");
  try {
    const canonical = await realpath(path), info = await stat(canonical);
    if (!info.isDirectory()) throw new Error("Not a directory");
    await access(canonical, constants.R_OK | constants.W_OK | constants.X_OK);
    return { path: canonical, identity: `${info.dev}:${info.ino}` };
  } catch { throw new CallError("invalid", "目录不存在或无法读写，请检查主机路径和权限。"); }
}
/** A snapshot marker is provenance only: it does not claim to back up arbitrary files. */
async function baseline(path: string, identity: string) {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
  const options = { timeout: 3000, maxBuffer: 8192, env };
  try {
    const { stdout: root } = await exec("git", ["-C", path, "rev-parse", "--show-toplevel"], options);
    // A directory inside somebody else's repository is still a valid independent project.
    if (await realpath(root.trim()) === path) {
      const { stdout } = await exec("git", ["-C", path, "rev-parse", "--verify", "HEAD^{commit}"], options);
      if (/^[a-f0-9]{40,64}$/.test(stdout.trim())) return `commit:${stdout.trim()}`;
    }
  } catch (error) {
    // git exits 128 for a non-repository or an unborn HEAD; neither prevents coding.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && typeof (error as { code?: unknown }).code !== "number") throw error;
  }
  return `snapshot:${createHash("sha256").update(`${path}\0${identity}`).digest("hex")}`;
}
/** Host-owned path grants; the module can select a registered reference, never supply execution cwd. */
export function createExecutionProjectRegistry(dataDir: string): NonNullable<StewardPorts["executionProjects"]> & { resolve(principal: ExecutionPrincipal, projectRef: string): Promise<ExecutionProjectGrant | null> } {
  const file = join(dataDir, "execution-project-registry.json");
  // Keep editable projects alongside the internal data root, outside platform and secrets.
  const workspaces = resolve(dataDir, "..", "workspaces");
  let tail: Promise<unknown> = Promise.resolve();
  async function read(): Promise<Registry> {
    try { return registrySchema.parse(JSON.parse(await readFile(file, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, projects: [], defaults: [] }; throw error; }
  }
  async function save(registry: Registry) {
    await mkdir(dataDir, { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(registry), { mode: 0o600 });
    await rename(temp, file);
  }
  function serialized<T>(action: () => Promise<T>): Promise<T> {
    const operation = tail.then(action);
    tail = operation.catch(() => {});
    return operation;
  }
  async function registered(registry: Registry, principal: ExecutionPrincipal, path: string) {
    const dir = await directory(path);
    const previous = registry.projects.find(row => matches(row, principal) && row.path === dir.path);
    if (previous) {
      if (previous.identity !== dir.identity) throw new CallError("conflict", "目录已被替换，请先核对原项目。");
      return previous;
    }
    if (registry.projects.length >= 100) throw new CallError("capacity", "已达到项目数量上限。");
    const row: Row = { workspaceId: principal.workspaceId, ownerId: principal.ownerId, callerKey: key(principal), projectRef: `local-${randomUUID()}`, path: dir.path, label: basename(dir.path) || dir.path, identity: dir.identity };
    registry.projects.push(row);
    return row;
  }
  async function checkDirectory(row: Row) {
    const current = await directory(row.path);
    if (current.path !== row.path || current.identity !== row.identity) throw new CallError("conflict", "已授权目录发生变化，请核对项目。");
  }
  return {
    async list(principal) { await tail; return { projects: (await read()).projects.filter(row => matches(row, principal)).map(view) }; },
    register(principal, path) {
      return serialized(async () => {
        const registry = await read(), count = registry.projects.length;
        const row = await registered(registry, principal, path);
        if (registry.projects.length !== count) await save(registry);
        return view(row);
      });
    },
    default(principal, path) {
      return serialized(async () => {
        const registry = await read();
        const pointer = registry.defaults.find(row => matches(row, principal));
        if (path === undefined && pointer) {
          const row = registry.projects.find(row => matches(row, principal) && row.projectRef === pointer.projectRef);
          if (!row) throw new CallError("conflict", "默认项目记录不存在，请重新选择目录。");
          await checkDirectory(row);
          return view(row);
        }
        const automatic = path === undefined;
        if (path === undefined) {
          const scope = JSON.stringify([principal.workspaceId, principal.ownerId, key(principal)]);
          path = join(workspaces, createHash("sha256").update(scope).digest("hex"));
          await mkdir(path, { recursive: true, mode: 0o700 });
        }
        const row = await registered(registry, principal, path);
        if (automatic) row.label = "默认空间";
        if (pointer) pointer.projectRef = row.projectRef;
        else registry.defaults.push({ workspaceId: row.workspaceId, ownerId: row.ownerId, callerKey: row.callerKey, projectRef: row.projectRef });
        await save(registry);
        return view(row);
      });
    },
    async resolve(principal, projectRef) {
      await tail;
      const row = (await read()).projects.find(row => matches(row, principal) && row.projectRef === projectRef);
      if (!row) return null;
      await checkDirectory(row);
      return { projectRef, executor: "server", canonicalPath: row.path, baseline: await baseline(row.path, row.identity) };
    },
  };
}

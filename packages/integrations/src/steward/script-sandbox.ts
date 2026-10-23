import { accessSync, constants, cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type Language = "python" | "shell" | "typescript";
export type ScriptSandboxResult = { status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null; exitCode?: number };
type ModuleDirs = { codeDir: string; dataDir: string; contentDir?: string; httpDir?: string; socketPath?: string; env?: Record<string, string> };
function executable(path: string | null | undefined): string | null {
  try { if (!path) return null; accessSync(path, constants.X_OK); return realpathSync(path); } catch { return null; }
}
function limits(...values: number[]) {
  for (const value of values) if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid sandbox limit");
}
function directory(path: string) {
  const resolved = realpathSync(path);
  if (!statSync(resolved).isDirectory() || resolved === "/") throw new Error("Invalid module directory");
  return resolved;
}
function language(entry: string): Language {
  if (!/^[A-Za-z0-9_-]+\.(ts|py|sh)$/.test(entry)) throw new Error("Invalid module entry");
  return ({ ".ts": "typescript", ".py": "python", ".sh": "shell" } as const)[extname(entry) as ".ts" | ".py" | ".sh"];
}
/**
 * Runs module processes inside bubblewrap when it is usable (isolated), otherwise as plain child
 * processes of the Chrona user, like Hermes' local backend. Modules find everything through
 * CHRONA_* variables and import the SDK as `chrona`, so the same code runs either way.
 */
export function createScriptSandbox({ bwrapPath, dataDir, timeoutMs = 60_000, maxOutputBytes = 64 * 1024, memoryMb = 512, moduleSdk = fileURLToPath(new URL("./module-sdk", import.meta.url)) }: {
  bwrapPath?: string; dataDir?: string; timeoutMs?: number; maxOutputBytes?: number; memoryMb?: number;
  /** The `chrona` package directory; packaged binaries pass the shipped copy. */
  moduleSdk?: string;
}) {
  limits(timeoutMs, maxOutputBytes, memoryMb);
  const bwrap = executable(bwrapPath);
  const interpreters = { python: executable(Bun.which("python3")), shell: executable(Bun.which("sh")), typescript: executable(Bun.which("bun")) };
  const shell = interpreters.shell;
  const paths = [...new Set(Object.values(interpreters).filter((p): p is string => !!p))];
  // Probe namespace support too: an installed binary is not necessarily usable.
  const isolated = !!(bwrap && shell && spawnSync(bwrap, ["--unshare-all", "--die-with-parent", "--ro-bind", "/", "/", "--", shell, "-c", "exit 0"], { env: {}, timeout: 3000, stdio: "ignore" }).status === 0);
  const available = !!shell;
  // Unsandboxed code directories (platform/store, platform/staging) resolve `chrona` from this ancestor.
  if (!isolated && dataDir) {
    const target = join(resolve(dataDir), "platform", "node_modules", "chrona");
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(moduleSdk, target, { recursive: true });
  }
  function command(entry: string, code: string) {
    const kind = language(entry), interpreter = interpreters[kind];
    if (!shell || !interpreter) throw new Error("模块运行环境不可用");
    // --no-install: never let Bun fetch an npm package named like a missing import.
    return [shell, "-c", 'ulimit -v "$1" || exit 125; shift; exec "$@"', "module", String(memoryMb * 1024), interpreter, ...(kind === "typescript" ? ["--no-install"] : []), join(code, entry)];
  }
  function spawnModule(dirs: ModuleDirs, entry: string, network: boolean) {
    const code = directory(dirs.codeDir), data = directory(dirs.dataDir), content = dirs.contentDir ? directory(dirs.contentDir) : undefined;
    const socket = dirs.socketPath ? resolve(dirs.socketPath) : undefined;
    if (socket && !statSync(socket).isSocket()) throw new Error("Invalid module socket");
    const http = dirs.httpDir ? directory(dirs.httpDir) : undefined;
    // Only non-secret CHRONA_* settings (e.g. CHRONA_PUBLIC_URL) pass through.
    const extra = Object.fromEntries(Object.entries(dirs.env ?? {}).filter(([key]) => /^CHRONA_[A-Z_]+$/.test(key)));
    if (!isolated) {
      const env = { ...extra, PATH: process.env.PATH ?? paths.map(dirname).join(":"), LANG: "C.UTF-8", ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
        CHRONA_MODULE: code, CHRONA_DATA: data, ...(content ? { CHRONA_CONTENT: content } : {}), ...(socket ? { CHRONA_SOCKET: socket } : {}), ...(http ? { CHRONA_HTTP_SOCKET: join(http, "s") } : {}) };
      const [file, ...args] = command(entry, code);
      // Own process group, so kill() also ends anything the module started.
      return spawn(file!, args, { cwd: code, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    }
    const hidden = [...new Set([homedir(), dataDir].filter((p): p is string => !!p).flatMap(p => { const path = resolve(p); return existsSync(path) ? [path, realpathSync(path)] : [path]; }))]
      .sort((a, b) => a.split(sep).length - b.split(sep).length);
    // A private root supplies mount points without creating anything on the host; it is frozen read-only before exec.
    const root = readdirSync("/").filter(name => !["module", "data", "content", "chrona", "node_modules", "tmp", "proc", "dev"].includes(name)).flatMap(name => ["--ro-bind", `/${name}`, `/${name}`]);
    const env = { ...extra, PATH: paths.map(dirname).join(":"), LANG: "C.UTF-8", CHRONA_MODULE: "/module", CHRONA_DATA: "/data", ...(content ? { CHRONA_CONTENT: "/content" } : {}),
      ...(socket ? { CHRONA_SOCKET: "/chrona/chrona.sock" } : {}), ...(http ? { CHRONA_HTTP_SOCKET: "/chrona/http/s" } : {}) };
    const profile = ["--unshare-all", ...(network ? ["--share-net"] : []), "--die-with-parent", "--new-session", "--tmpfs", "/", ...root,
      "--tmpfs", "/tmp", ...hidden.flatMap(p => ["--tmpfs", p]), "--proc", "/proc", "--dev", "/dev", ...paths.flatMap(p => ["--ro-bind", p, p]),
      "--ro-bind", code, "/module", "--bind", data, "/data", ...(content ? ["--bind", content, "/content"] : []),
      "--ro-bind", resolve(moduleSdk), "/node_modules/chrona", "--dir", "/chrona", ...(socket ? ["--ro-bind", socket, "/chrona/chrona.sock"] : []),
      ...(http ? ["--bind", http, "/chrona/http"] : []), "--remount-ro", "/", "--chdir", "/module",
      "--clearenv", ...Object.entries(env).flatMap(([key, value]) => ["--setenv", key, value])];
    return spawn(bwrap!, [...profile, "--", ...command(entry, "/module")], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
  }
  function kill(child: ReturnType<typeof spawn>) {
    try { if (!isolated && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* Already exited. */ }
  }
  return {
    health: { available, isolated },
    startModule({ codeDir, dataDir: moduleData, contentDir, httpDir, env, entry, socketPath, network = false }: { codeDir: string; dataDir: string; contentDir?: string; httpDir?: string; env?: Record<string, string>; entry: string; socketPath: string; network?: boolean }) {
      const child = spawnModule({ codeDir, dataDir: moduleData, contentDir, httpDir, socketPath, env }, entry, network);
      child.stdin!.end();
      child.stdout!.resume();
      let errors = Buffer.alloc(0);
      child.stderr!.on("data", (chunk: Buffer) => { errors = Buffer.concat([errors, chunk]).subarray(-16 * 1024); });
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      return { pid: child.pid!, exited, stderr: () => errors.toString("utf8"), kill: () => kill(child) };
    },
    /** One-shot run with JSON on stdin: author tests and data migrations. */
    async runModule({ codeDir, dataDir: moduleData, contentDir, entry, input, network = false, timeoutMs: runTimeout = timeoutMs, maxOutputBytes: outputLimit = maxOutputBytes }: { codeDir: string; dataDir: string; contentDir?: string; entry: string; input: unknown; network?: boolean; timeoutMs?: number; maxOutputBytes?: number }): Promise<ScriptSandboxResult> {
      limits(runTimeout, outputLimit);
      language(entry);
      if (!available) return { status: "unavailable", output: "", error: "模块运行环境不可用" };
      const child = spawnModule({ codeDir, dataDir: moduleData, contentDir }, entry, network);
      return new Promise(resolve => {
        let output = Buffer.alloc(0), errors = Buffer.alloc(0), timedOut = false;
        const timer = setTimeout(() => { timedOut = true; kill(child); }, runTimeout);
        const cap = (previous: Buffer, next: Buffer) => Buffer.concat([previous, next.subarray(0, Math.max(0, outputLimit - previous.length))]);
        child.stdout!.on("data", (chunk: Buffer) => { output = cap(output, chunk); });
        child.stderr!.on("data", (chunk: Buffer) => { errors = cap(errors, chunk); });
        child.stdin!.on("error", () => { /* Early exit closes stdin. */ });
        child.on("error", () => { clearTimeout(timer); resolve({ status: "unavailable", output: "", error: "模块运行环境不可用" }); });
        child.on("close", code => {
          clearTimeout(timer);
          resolve({ exitCode: code ?? 1, status: timedOut ? "timed_out" : code === 0 ? "succeeded" : "failed", output: new TextDecoder().decode(output, { stream: true }), error: timedOut ? "脚本运行超时" : errors.length ? new TextDecoder().decode(errors, { stream: true }) : code === 0 ? null : `脚本退出：${code}` });
        });
        child.stdin!.end(JSON.stringify(input));
      });
    },
  };
}

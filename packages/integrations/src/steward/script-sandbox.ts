import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type Language = "python" | "shell" | "typescript";
export type ScriptSandboxResult = { status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null; exitCode?: number };
function executable(path: string | null | undefined): string | null {
  try { if (!path) return null; accessSync(path, constants.X_OK); return realpathSync(path); } catch { return null; }
}
function limits(...values: number[]) {
  for (const value of values) if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid sandbox limit");
}
function workspaceDirectory(cwd?: string) {
  if (cwd === undefined) return undefined;
  const directory = realpathSync(cwd);
  if (!statSync(directory).isDirectory() || directory === "/") throw new Error("Invalid sandbox cwd");
  return directory;
}
// Keep sensitive trees hidden even when a script needs the host runtime and network.
export function scriptWorkspaceArguments(directory: string, paths: string[], dataDir?: string) {
  const hidden = [...new Set([homedir(), dataDir].filter((p): p is string => !!p)
    .flatMap(p => { const path = resolve(p); return existsSync(path) ? [path, realpathSync(path)] : [path]; }))]
    .sort((a, b) => a.split(sep).length - b.split(sep).length);
  return ["--unshare-all", "--share-net", "--die-with-parent", "--new-session", "--ro-bind", "/", "/",
    "--tmpfs", "/tmp", ...hidden.flatMap(p => ["--tmpfs", p]), "--proc", "/proc", "--dev", "/dev",
    ...paths.flatMap(p => ["--ro-bind", p, p]), "--bind", directory, directory, "--chdir", directory,
    "--clearenv", "--setenv", "PATH", paths.map(dirname).join(":"), "--setenv", "LANG", "C.UTF-8"];
}
/** Scripts may write only cwd (plus private /tmp); no inherited environment or host fallback. */
export function createScriptSandbox({ bwrapPath, dataDir, timeoutMs = 60_000, maxOutputBytes = 64 * 1024, memoryMb = 512, moduleSdk = fileURLToPath(new URL("./module-sdk/sdk.ts", import.meta.url)) }: {
  bwrapPath?: string; dataDir?: string; timeoutMs?: number; maxOutputBytes?: number; memoryMb?: number;
  /** Packaged binaries pass the shipped copy; the source path does not exist inside a compiled binary. */
  moduleSdk?: string;
}) {
  limits(timeoutMs, maxOutputBytes, memoryMb);
  const bwrap = executable(bwrapPath);
  const interpreters = { python: executable(Bun.which("python3")), shell: executable(Bun.which("sh")), typescript: executable(Bun.which("bun")) };
  const shell = interpreters.shell;
  const paths = [...new Set(Object.values(interpreters).filter((p): p is string => !!p))];
  const base = ["--unshare-all", "--die-with-parent", "--new-session", "--ro-bind", "/nix/store", "/nix/store",
    ...paths.flatMap(p => ["--ro-bind", p, p]), "--tmpfs", "/tmp", "--chdir", "/tmp", "--proc", "/proc", "--dev", "/dev",
    "--clearenv", "--setenv", "PATH", paths.map(dirname).join(":"), "--setenv", "LANG", "C.UTF-8"];
  // Probe namespace support too: an installed binary is not necessarily usable.
  const available = !!(bwrap && shell && spawnSync(bwrap, [...base, "--", shell, "-c", "exit 0"], { env: {}, timeout: 3000, stdio: "ignore" }).status === 0);
  const languages = available ? (Object.keys(interpreters) as Language[]).filter(l => interpreters[l]) : [];
  async function execute({ language, args, input, profile, runTimeout, outputLimit }: { language: Language; args: string[]; input: unknown; profile: string[]; runTimeout: number; outputLimit: number }): Promise<ScriptSandboxResult> {
      limits(runTimeout, outputLimit);
      const interpreter = interpreters[language];
      if (!available || !bwrap || !shell || !interpreter) return { status: "unavailable", output: "", error: "沙箱不可用" };
      return new Promise(resolve => {
        let output = Buffer.alloc(0), errors = Buffer.alloc(0), timedOut = false;
        const child = spawn(bwrap, [...profile, "--", shell, "-c", 'ulimit -v "$1" || exit 125; shift; exec "$@"', "sandbox", String(memoryMb * 1024), interpreter, ...args], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
        const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, runTimeout);
        const cap = (previous: Buffer, next: Buffer) => Buffer.concat([previous, next.subarray(0, Math.max(0, outputLimit - previous.length))]);
        child.stdout.on("data", (chunk: Buffer) => { output = cap(output, chunk); });
        child.stderr.on("data", (chunk: Buffer) => { errors = cap(errors, chunk); });
        child.stdin.on("error", () => { /* Early exit closes stdin. */ });
        child.on("error", () => { clearTimeout(timer); resolve({ status: "unavailable", output: "", error: "沙箱不可用" }); });
        child.on("close", code => {
          clearTimeout(timer);
          resolve({ exitCode: code ?? 1, status: timedOut ? "timed_out" : code === 0 ? "succeeded" : "failed", output: new TextDecoder().decode(output, { stream: true }), error: timedOut ? "脚本运行超时" : errors.length ? new TextDecoder().decode(errors, { stream: true }) : code === 0 ? null : `脚本退出：${code}` });
        });
        child.stdin.end(JSON.stringify(input));
      });
  }
  return {
    health: { available, languages },
    async run({ language, source, input, cwd, timeoutMs: runTimeout = timeoutMs, maxOutputBytes: outputLimit = maxOutputBytes }: { language: Language; source: string; input: unknown; cwd?: string; timeoutMs?: number; maxOutputBytes?: number }): Promise<ScriptSandboxResult> {
      const directory = workspaceDirectory(cwd);
      const profile = directory ? scriptWorkspaceArguments(directory, paths, dataDir) : base;
      return execute({ language, args: [language === "typescript" ? "-e" : "-c", source], input, profile, runTimeout, outputLimit });
    },
    startModule({ codeDir, dataDir: moduleData, entry, socketPath, network = false }: { codeDir: string; dataDir: string; entry: string; socketPath: string; network?: boolean }) {
      if (!/^[A-Za-z0-9_-]+\.(ts|py|sh)$/.test(entry)) throw new Error("Invalid module entry");
      const language = ({ ".ts": "typescript", ".py": "python", ".sh": "shell" } as const)[extname(entry) as ".ts" | ".py" | ".sh"];
      const interpreter = interpreters[language];
      if (!available || !bwrap || !shell || !interpreter) throw new Error("沙箱不可用");
      const code = workspaceDirectory(codeDir)!, data = workspaceDirectory(moduleData)!;
      const socket = resolve(socketPath);
      if (!statSync(socket).isSocket()) throw new Error("Invalid module socket");
      const profile = scriptWorkspaceArguments(code, paths, dataDir);
      profile.splice(profile.indexOf("--bind"), 5, "--ro-bind", code, "/module", "--bind", data, "/data", "--chdir", "/module");
      profile.splice(profile.indexOf("--ro-bind"), 3, "--tmpfs", "/",
        ...readdirSync("/").filter(name => !["module", "data", "chrona", "tmp", "proc", "dev"].includes(name)).flatMap(name => ["--ro-bind", `/${name}`, `/${name}`]));
      profile.push("--dir", "/chrona", "--ro-bind", socket, "/chrona/chrona.sock",
        "--ro-bind", moduleSdk, "/chrona/sdk.ts", "--remount-ro", "/");
      if (!network) profile.splice(profile.indexOf("--share-net"), 1);
      const child = spawn(bwrap, [...profile, "--", shell, "-c", 'ulimit -v "$1" || exit 125; shift; exec "$@"', "sandbox", String(memoryMb * 1024), interpreter, `/module/${entry}`], { env: {}, stdio: ["ignore", "ignore", "pipe"] });
      let errors = Buffer.alloc(0);
      child.stderr.on("data", (chunk: Buffer) => { errors = Buffer.concat([errors, chunk]).subarray(-16 * 1024); });
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      return { pid: child.pid!, exited, stderr: () => errors.toString("utf8"), kill: () => { child.kill("SIGKILL"); } };
    },
    async runModule({ codeDir, dataDir: moduleData, entry, input, network = false, timeoutMs: runTimeout = timeoutMs, maxOutputBytes: outputLimit = maxOutputBytes }: { codeDir: string; dataDir: string; entry: string; input: unknown; network?: boolean; timeoutMs?: number; maxOutputBytes?: number }): Promise<ScriptSandboxResult> {
      if (!/^[A-Za-z0-9_-]+\.(ts|py|sh)$/.test(entry)) throw new Error("Invalid module entry");
      const language = ({ ".ts": "typescript", ".py": "python", ".sh": "shell" } as const)[extname(entry) as ".ts" | ".py" | ".sh"];
      const code = workspaceDirectory(codeDir)!, data = workspaceDirectory(moduleData)!;
      // Reuse the P0 root/home/data masks, but never expose a writable code mount.
      const profile = scriptWorkspaceArguments(code, paths, dataDir);
      const mount = profile.indexOf("--bind");
      profile.splice(mount, 5, "--ro-bind", code, "/module", "--bind", data, "/data", "--chdir", "/module");
      // A private root supplies mount points without creating anything on the host.
      // Keep the P0 host view read-only, then freeze the private root before exec.
      profile.splice(profile.indexOf("--ro-bind"), 3, "--tmpfs", "/",
        ...readdirSync("/").filter(name => !["module", "data", "tmp", "proc", "dev"].includes(name)).flatMap(name => ["--ro-bind", `/${name}`, `/${name}`]));
      profile.push("--remount-ro", "/");
      if (!network) profile.splice(profile.indexOf("--share-net"), 1);
      return execute({ language, args: [`/module/${entry}`], input, profile, runTimeout, outputLimit });
    },
  };
}

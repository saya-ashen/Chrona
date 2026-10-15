import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";

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
/** Jobs may write only cwd (plus private /tmp); no inherited environment or host fallback. */
export function createScriptSandbox({ bwrapPath, timeoutMs = 60_000, maxOutputBytes = 64 * 1024, memoryMb = 512 }: {
  bwrapPath?: string; timeoutMs?: number; maxOutputBytes?: number; memoryMb?: number;
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
  return {
    health: { available, languages },
    async run({ language, source, input, cwd, timeoutMs: runTimeout = timeoutMs, maxOutputBytes: outputLimit = maxOutputBytes }: { language: Language; source: string; input: unknown; cwd?: string; timeoutMs?: number; maxOutputBytes?: number }): Promise<ScriptSandboxResult> {
      limits(runTimeout, outputLimit);
      const directory = workspaceDirectory(cwd);
      // Mount the workspace after /tmp so OS-temp affair directories remain visible.
      const profile = directory ? ["--unshare-all", "--share-net", "--die-with-parent", "--new-session", "--ro-bind", "/", "/",
        "--tmpfs", "/tmp", "--proc", "/proc", "--dev", "/dev", "--bind", directory, directory, "--chdir", directory,
        "--clearenv", "--setenv", "PATH", paths.map(dirname).join(":"), "--setenv", "LANG", "C.UTF-8"] : base;
      const interpreter = interpreters[language];
      if (!available || !bwrap || !shell || !interpreter) return { status: "unavailable", output: "", error: "沙箱不可用" };
      return new Promise(resolve => {
        let output = Buffer.alloc(0), errors = Buffer.alloc(0), timedOut = false;
        const child = spawn(bwrap, [...profile, "--", shell, "-c", 'ulimit -v "$1" || exit 125; shift; exec "$@"', "sandbox", String(memoryMb * 1024), interpreter, language === "typescript" ? "-e" : "-c", source], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
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
    },
  };
}

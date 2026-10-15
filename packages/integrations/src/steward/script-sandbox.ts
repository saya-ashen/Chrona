import { accessSync, constants, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";

type Language = "python" | "shell" | "typescript";
export type ScriptSandboxResult = { status: "succeeded" | "failed" | "timed_out" | "unavailable"; output: string; error: string | null };
function executable(path: string | null | undefined): string | null {
  try { if (!path) return null; accessSync(path, constants.X_OK); return realpathSync(path); } catch { return null; }
}
/** No host writable mounts, inherited environment, network, or fallback execution. */
export function createScriptSandbox({ bwrapPath, timeoutMs = 60_000, maxOutputBytes = 64 * 1024, memoryMb = 512 }: {
  bwrapPath?: string; timeoutMs?: number; maxOutputBytes?: number; memoryMb?: number;
}) {
  for (const value of [timeoutMs, maxOutputBytes, memoryMb]) if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid sandbox limit");
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
    async run({ language, source, input }: { language: Language; source: string; input: unknown }): Promise<ScriptSandboxResult> {
      const interpreter = interpreters[language];
      if (!available || !bwrap || !shell || !interpreter) return { status: "unavailable", output: "", error: "沙箱不可用" };
      return new Promise(resolve => {
        let output = Buffer.alloc(0), errors = Buffer.alloc(0), timedOut = false;
        const child = spawn(bwrap, [...base, "--", shell, "-c", 'ulimit -v "$1" || exit 125; shift; exec "$@"', "sandbox", String(memoryMb * 1024), interpreter, language === "typescript" ? "-e" : "-c", source], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
        const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
        const cap = (previous: Buffer, next: Buffer) => Buffer.concat([previous, next.subarray(0, Math.max(0, maxOutputBytes - previous.length))]);
        child.stdout.on("data", (chunk: Buffer) => { output = cap(output, chunk); });
        child.stderr.on("data", (chunk: Buffer) => { errors = cap(errors, chunk); });
        child.stdin.on("error", () => { /* Early exit closes stdin. */ });
        child.on("error", () => { clearTimeout(timer); resolve({ status: "unavailable", output: "", error: "沙箱不可用" }); });
        child.on("close", code => {
          clearTimeout(timer);
          resolve({ status: timedOut ? "timed_out" : code === 0 ? "succeeded" : "failed", output: new TextDecoder().decode(output, { stream: true }), error: timedOut ? "脚本运行超时" : errors.length ? new TextDecoder().decode(errors, { stream: true }) : code === 0 ? null : `脚本退出：${code}` });
        });
        child.stdin.end(JSON.stringify(input));
      });
    },
  };
}

import { requireDescendantStop, spawnSupervised } from "@chrona/process";
import { existsSync } from "node:fs";
import { join } from "node:path";

type Installed = { npm: boolean; python: boolean; packages: Record<string, string[]> };
// Installers get the host toolchain environment, never Chrona's own secrets (API_KEY, RESCUE_KEY ...).
const environment = () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
  entry[1] !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA|HOME|LANG|TMP|TEMP|TMPDIR|SSL_CERT_FILE|XDG_[A-Z_]+|UV_CACHE_DIR|BUN_INSTALL_CACHE_DIR)$/i.test(entry[0])));

async function run(command: string[], cwd: string, timeoutMs: number, processHelper?: string) {
  let output = "";
  const task = spawnSupervised(command[0]!, command.slice(1), { cwd, env: environment(), timeoutMs, helperPath: processHelper });
  task.process.stdin.end();
  const keep = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-4000); };
  task.process.stdout.on("data", keep); task.process.stderr.on("data", keep);
  // Unknown cleanup must reject the install, before another installer or a build can run.
  const exit = requireDescendantStop(await task.exited);
  return { code: exit.signal || exit.stop.reason !== "exit" ? 1 : exit.code, output };
}

/** Classify only explicit installer evidence; ambiguous failures retain the original diagnostic. */
function installFailure(command: string, output: string) {
  const cause = /lockfile had changes, but lockfile is frozen/i.test(output)
    ? "lockfile mismatch"
    : /(?:offline mode|network connectivity is disabled)/i.test(output) && /(?:(?:not|wasn't) (?:found|available).*cache|could not find.*cache|cache.*(?:miss|not found))/i.test(output)
      ? "offline dependency unavailable in cache" : null;
  return `${command} failed${cause ? ` (${cause})` : ""}:\n${output}`;
}

async function installNpm(dir: string, timeoutMs: number, has: (file: string) => boolean, processHelper?: string) {
  if (!has("package.json")) return undefined;
  if (!has("bun.lock")) return "package.json needs bun.lock: run bun install and submit the lockfile";
  const bun = Bun.which("bun");
  if (!bun) return "bun is not available on this host";
  // Local file: dependencies must not hardlink approved vendor material into node_modules.
  // Material verification requires single-link files, including after dependency preparation.
  const result = await run([bun, "install", "--frozen-lockfile", "--ignore-scripts", "--no-progress", "--backend=copyfile"], dir, timeoutMs, processHelper);
  return result.code === 0 ? true : installFailure("bun install --frozen-lockfile", result.output);
}

async function installPython(dir: string, timeoutMs: number, has: (file: string) => boolean, processHelper?: string) {
  if (!has("pyproject.toml")) return undefined;
  if (!has("uv.lock")) return "pyproject.toml needs uv.lock: run uv lock and submit the lockfile";
  const uv = Bun.which("uv");
  if (!uv) return "uv is not available on this host";
  const python = Bun.which("python3") ?? Bun.which("python");
  if (!python) return "python3 or python is not available on this host";
  // uv creates .venv/bin on POSIX and .venv/Scripts on Windows using this host interpreter.
  const result = await run([uv, "sync", "--frozen", "--python", python, "--no-python-downloads"], dir, timeoutMs, processHelper);
  return result.code === 0 ? true : installFailure("uv sync --frozen", result.output);
}

/** Language libraries come from lockfiles; declared programs must already be installed on the host. */
export function createModulePackages({ timeoutMs = 600_000, processHelper }: { timeoutMs?: number; processHelper?: string } = {}) {
  return {
    async install({ dir, packages }: { dir: string; packages: string[] }) {
      const errors: string[] = [], installed: Installed = { npm: false, python: false, packages: {} }, has = (file: string) => existsSync(join(dir, file));
      const npm = await installNpm(dir, timeoutMs, has, processHelper);
      if (npm !== undefined) {
        if (npm === true) installed.npm = true;
        else errors.push(npm);
      }
      const python = await installPython(dir, timeoutMs, has, processHelper);
      if (python !== undefined) {
        if (python === true) installed.python = true;
        else errors.push(python);
      }
      const missing: string[] = [];
      for (const name of new Set(packages)) {
        const program = Bun.which(name);
        if (program) installed.packages[name] = [program];
        else missing.push(name);
      }
      if (missing.length) errors.push(`Missing system programs: ${missing.join(", ")}. Ask the user to install them on the host, then submit the module again.`);
      return { errors, installed };
    },
  };
}

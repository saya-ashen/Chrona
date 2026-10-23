import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Program names checked under the system backend map to an install hint for the detected package manager. */
const MANAGERS = [["apt-get", "sudo apt install"], ["dnf", "sudo dnf install"], ["pacman", "sudo pacman -S"], ["zypper", "sudo zypper install"], ["apk", "sudo apk add"]] as const;
// Installers get the host toolchain environment, never Chrona's own secrets (API_KEY, RESCUE_KEY ...).
const environment = () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
  entry[1] !== undefined && /^(PATH|HOME|LANG|TMPDIR|SSL_CERT_FILE|NIX_[A-Z_]+|XDG_[A-Z_]+|UV_CACHE_DIR|BUN_INSTALL_CACHE_DIR)$/.test(entry[0])));

function run(command: string[], cwd: string, timeoutMs: number) {
  return new Promise<{ code: number | null; output: string }>(resolve => {
    let output = "";
    const child = spawn(command[0]!, command.slice(1), { cwd, env: environment(), stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const keep = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-4000); };
    child.stdout.on("data", keep); child.stderr.on("data", keep);
    child.on("error", error => { clearTimeout(timer); resolve({ code: null, output: error.message }); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, output }); });
  });
}
/**
 * v2-6 dependencies, per host: language libraries only from lockfiles (no version resolution, no install scripts);
 * system programs from nixpkgs (pinned by CHRONA_NIXPKGS, GC-rooted per module version) or, without Nix, from
 * whatever the user installed with the distribution's package manager.
 */
export function createModulePackages({ nixpkgs = process.env.CHRONA_NIXPKGS?.trim() || "nixpkgs", timeoutMs = 600_000, backend = Bun.which("nix") ? "nix" : "system" }: { nixpkgs?: string; timeoutMs?: number; backend?: "nix" | "system" } = {}) {
  const nix = Bun.which("nix"), bun = Bun.which("bun"), uv = Bun.which("uv"), python = Bun.which("python3");
  return {
    backend,
    async install({ dir, packages, gcroot }: { dir: string; packages: string[]; gcroot: string }) {
      const errors: string[] = [], installed: { npm: boolean; python: boolean; packages: Record<string, string[]> } = { npm: false, python: false, packages: {} };
      const has = (file: string) => existsSync(join(dir, file));
      if (has("package.json")) {
        if (!has("bun.lock")) errors.push("package.json needs bun.lock: run bun install and submit the lockfile");
        else if (!bun) errors.push("bun is not available on this host");
        else {
          const result = await run([bun, "install", "--frozen-lockfile", "--ignore-scripts", "--no-progress"], dir, timeoutMs);
          if (result.code === 0) installed.npm = true; else errors.push(`bun install --frozen-lockfile failed:\n${result.output}`);
        }
      }
      if (has("pyproject.toml")) {
        if (!has("uv.lock")) errors.push("pyproject.toml needs uv.lock: run uv lock and submit the lockfile");
        else if (!uv || !python) errors.push(`${uv ? "python3" : "uv"} is not available on this host`);
        else {
          // The venv's interpreter is the host python3, which modules can see with or without a sandbox.
          const result = await run([uv, "sync", "--frozen", "--python", python, "--no-python-downloads"], dir, timeoutMs);
          if (result.code === 0) installed.python = true; else errors.push(`uv sync --frozen failed:\n${result.output}`);
        }
      }
      const bin: string[] = [];
      if (packages.length && backend === "nix") {
        await mkdir(gcroot, { recursive: true });
        for (const name of packages) {
          // --out-link keeps the store paths alive as long as this module version is kept.
          const result = await run([nix!, "--extra-experimental-features", "nix-command flakes", "build", "--print-out-paths", "--out-link", join(gcroot, name), `${nixpkgs}#${name}`], dir, timeoutMs);
          const paths = result.output.split("\n").filter(line => line.startsWith("/nix/store/"));
          if (result.code !== 0 || !paths.length) { errors.push(`nix build ${nixpkgs}#${name} failed:\n${result.output}`); continue; }
          installed.packages[name] = paths;
          bin.push(...paths.map(path => join(path, "bin")).filter(existsSync));
        }
      } else if (packages.length) {
        const missing = packages.filter(name => !Bun.which(name));
        const manager = MANAGERS.find(([command]) => Bun.which(command));
        if (missing.length) errors.push(`Missing system programs: ${missing.join(", ")}. Ask the user to install them on the host${manager ? ` (${manager[1]} ${missing.join(" ")})` : ""}, then submit the module again.`);
        for (const name of packages.filter(name => !missing.includes(name))) installed.packages[name] = [Bun.which(name)!];
      }
      if (bin.length) {
        await mkdir(join(dir, ".chrona"), { recursive: true });
        await writeFile(join(dir, ".chrona", "packages.json"), JSON.stringify({ backend, bin }));
      }
      return { errors, installed };
    },
  };
}

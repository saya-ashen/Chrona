import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

/** Programs tried on PATH, in order. */
const NAMES = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"];
/**
 * Hosts without Nix get Chrome for Testing's headless shell, pinned and checked: Google publishes no checksums.
 * Upgrade by changing version and sha256 together (sha256 of the linux64 zip).
 */
export const HEADLESS_SHELL = {
  version: "155.0.8059.39",
  sha256: "39dcb8c46550632a3d911850ab3b8af840b4e3f6d8622faa2018eb8756278786",
  url: "https://storage.googleapis.com/chrome-for-testing-public/155.0.8059.39/linux64/chrome-headless-shell-linux64.zip",
};
type Options = {
  /** Explicit browser executable (CHRONA_STEWARD_BROWSER); used when it exists. */
  configured?: string;
  /** Chrona-owned directory for acquired browsers, e.g. <dataDir>/providers/browser. */
  dir: string;
  nix?: string | null; nixpkgs?: string;
  /** PATH to search (default: Chrona's). */
  path?: string;
  download?: (url: string) => Promise<ArrayBuffer>;
  /** The pinned download (default HEADLESS_SHELL); tests pin their own archive. */
  pinned?: typeof HEADLESS_SHELL;
  onError?: (error: string) => void;
};
function run(command: string, args: string[], timeoutMs: number) {
  return new Promise<{ code: number | null; output: string }>(resolveRun => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const collect = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-4000); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.once("error", error => { clearTimeout(timer); resolveRun({ code: null, output: error.message }); });
    child.once("close", code => { clearTimeout(timer); resolveRun({ code, output }); });
  });
}
async function unzip(zip: string, target: string) {
  const unzipper = Bun.which("unzip"), python = Bun.which("python3");
  const result = unzipper ? await run(unzipper, ["-q", zip, "-d", target], 120_000)
    : python ? await run(python, ["-I", "-m", "zipfile", "-e", zip, target], 120_000)
    : { code: null, output: "Neither unzip nor python3 is installed" };
  if (result.code !== 0) throw new Error(`Unpacking the browser failed: ${result.output}`);
}

/**
 * The Provider's browser (v2-12): an explicit path, one on PATH, or one Chrona acquired before. `ensure` starts acquiring
 * one when none is found (nix build, else the pinned download) and answers with what exists now; a failure is reported
 * once and not retried until Chrona restarts, so a missing unzip never repeats a 120 MB download on every run.
 */
export function createBrowsers(options: Options) {
  const pinned = options.pinned ?? HEADLESS_SHELL, nixLink = join(options.dir, "nix");
  const shell = join(options.dir, pinned.version, "chrome-headless-shell-linux64", "chrome-headless-shell");
  let acquiring: Promise<void> | null = null, failed = false;
  function find(): string | null {
    const candidates = [options.configured, ...NAMES.map(name => Bun.which(name, options.path === undefined ? undefined : { PATH: options.path })), join(nixLink, "bin", "chromium"), shell];
    for (const candidate of candidates) if (candidate && existsSync(candidate)) return realpathSync(candidate);
    return null;
  }
  async function acquire() {
    if (options.nix) {
      const result = await run(options.nix, ["--extra-experimental-features", "nix-command flakes", "build", "--out-link", nixLink, `${options.nixpkgs ?? "nixpkgs"}#chromium`], 1_200_000);
      if (result.code !== 0) throw new Error(`nix build chromium failed: ${result.output}`);
      return;
    }
    if (process.platform !== "linux" || process.arch !== "x64") throw new Error(`No browser download for ${process.platform}-${process.arch}; install Chromium and set CHRONA_STEWARD_BROWSER`);
    const bytes = new Uint8Array(await (options.download ?? (async url => {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(600_000) });
      if (!response.ok) throw new Error(`Browser download returned HTTP ${response.status}`);
      return response.arrayBuffer();
    }))(pinned.url));
    if (createHash("sha256").update(bytes).digest("hex") !== pinned.sha256) throw new Error("Browser download does not match the pinned SHA-256");
    const staging = join(options.dir, `${pinned.version}.partial`), zip = `${staging}.zip`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      await writeFile(zip, bytes, { mode: 0o600 });
      await unzip(zip, staging);
      // python3's zipfile drops the executable bit.
      await chmod(join(staging, "chrome-headless-shell-linux64", "chrome-headless-shell"), 0o755);
      await rename(staging, join(options.dir, pinned.version));
    } finally { await rm(zip, { force: true }); await rm(staging, { recursive: true, force: true }); }
  }
  return {
    find,
    ensure(): string | null {
      const found = find();
      if (!found && !acquiring && !failed) {
        acquiring = mkdir(options.dir, { recursive: true }).then(acquire).catch((error: unknown) => {
          failed = true;
          options.onError?.(error instanceof Error ? error.message : String(error));
        }).finally(() => { acquiring = null; });
      }
      return found;
    },
    /** Resolves when the acquisition `ensure` started (if any) has ended; for tests and shutdown. */
    settled: () => acquiring ?? Promise.resolve(),
  };
}
export type Browsers = ReturnType<typeof createBrowsers>;

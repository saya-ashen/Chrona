import { resolve, dirname, join } from "node:path";

const packageDir = resolve(dirname(import.meta.filename!), "..");

// ──────────────────────────────────────────────────────────────
// Environment / config
// ──────────────────────────────────────────────────────────────

const BUN_ENTRY = "dist/bun-entry.js";
const BUN_VERSION = process.env.CHRONA_BUN_VERSION ?? "1.3.11";

function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
}

function getRuntimeDir(): string {
  if (process.env.CHRONA_RUNTIME_DIR) return process.env.CHRONA_RUNTIME_DIR;
  if (process.env.CHRONA_DATA_DIR) return join(process.env.CHRONA_DATA_DIR, "runtime");
  const home = getHome();
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "chrona", "runtime");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "chrona", "runtime");
  return join(
    process.env.XDG_DATA_HOME ?? join(home, ".local", "share"),
    "chrona",
    "runtime",
  );
}

function getCachedBunPath(): string {
  const dir = getRuntimeDir();
  const ext = process.platform === "win32" ? ".exe" : "";
  return join(dir, `bun-${BUN_VERSION}${ext}`);
}

// ──────────────────────────────────────────────────────────────
// Platform / architecture detection
// ──────────────────────────────────────────────────────────────

function getPlatform(): string {
  switch (process.platform) {
    case "linux": return "linux";
    case "darwin": return "darwin";
    case "win32": return "windows";
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function getArch(): string {
  switch (process.arch) {
    case "x64": return "x64";
    case "arm64": return "aarch64";
    default:
      throw new Error(`Unsupported architecture: ${process.arch}`);
  }
}

// ──────────────────────────────────────────────────────────────
// Bun version validation
// ──────────────────────────────────────────────────────────────

function checkBunVersion(bunPath: string): boolean {
  try {
    const result = Bun.spawnSync([bunPath, "--version"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    if (result.exitCode !== 0 || !result.stdout) return false;
    const version = result.stdout.toString().trim();
    if (version.localeCompare(BUN_VERSION, undefined, { numeric: true }) < 0) {
      console.error(`Chrona requires Bun >= ${BUN_VERSION}, found ${version} at ${bunPath}`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Bun resolution
// ──────────────────────────────────────────────────────────────

function existsSync(p: string): boolean {
  const f = Bun.file(p);
  try { return f.size !== undefined; } catch { return false; }
}

function resolveBun(): string {
  // 1. CHRONA_BUN_PATH
  if (process.env.CHRONA_BUN_PATH) {
    const p = process.env.CHRONA_BUN_PATH;
    if (!existsSync(p)) {
      console.error(`CHRONA_BUN_PATH is set but file not found: ${p}`);
      process.exit(1);
    }
    if (!checkBunVersion(p)) process.exit(1);
    return p;
  }

  // 2. PATH lookup
  try {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const result = Bun.spawnSync([whichCmd, "bun"], { stdio: ["pipe", "pipe", "pipe"] });
    if (result.exitCode === 0 && result.stdout) {
      const systemBun = result.stdout.toString().trim().split("\n")[0].trim();
      if (existsSync(systemBun) && checkBunVersion(systemBun)) {
        console.log(`Chrona uses Bun at ${systemBun}`);
        return systemBun;
      }
    }
  } catch { /* fall through */ }

  // 3. Cached Bun in Chrona runtime dir
  const cached = getCachedBunPath();
  if (existsSync(cached) && checkBunVersion(cached)) {
    console.log(`Chrona uses cached Bun at ${cached}`);
    return cached;
  }

  // 4. Download
  if (process.env.CHRONA_SKIP_BUN_DOWNLOAD === "1") {
    console.error("");
    console.error("❌  Bun is not available on this system.");
    console.error("");
    console.error("    Install Bun manually: https://bun.sh/docs/installation");
    console.error("    Or set CHRONA_BUN_PATH=/path/to/bun");
    console.error("");
    process.exit(1);
  }

  console.log("Chrona uses Bun as its runtime.");
  console.log(`Downloading Bun ${BUN_VERSION} to ${getRuntimeDir()} ...`);
  return downloadAndCacheBun();
}

// ──────────────────────────────────────────────────────────────
// Bun download
// ──────────────────────────────────────────────────────────────

function findDownloadTool(): "curl" | "wget" | null {
  try {
    const r = Bun.spawnSync(["curl", "--version"], { stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
    if (r.exitCode === 0) return "curl";
  } catch { /* */ }
  try {
    const r = Bun.spawnSync(["wget", "--version"], { stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
    if (r.exitCode === 0) return "wget";
  } catch { /* */ }
  return null;
}

function downloadFile(url: string, dest: string): void {
  const tool = findDownloadTool();
  if (!tool) {
    throw new Error("Neither curl nor wget is available. Install one of them to auto-download Bun.");
  }

  const args = tool === "curl"
    ? ["-fsSL", url, "-o", dest]
    : ["-q", url, "-O", dest];

  const result = Bun.spawnSync([tool, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`${tool} failed with exit code ${result.exitCode}`);
  }
}

function downloadAndCacheBun(): string {
  const platform = getPlatform();
  const arch = getArch();

  if (platform === "windows") {
    console.error("");
    console.error("❌  Automatic Bun download is not supported on Windows.");
    console.error("");
    console.error("    Install Bun from: https://bun.sh/docs/installation");
    console.error("    Then set CHRONA_BUN_PATH=C:\\path\\to\\bun.exe");
    console.error("");
    process.exit(1);
  }

  const runtimeDir = getRuntimeDir();
  import.meta.require?.("node:fs").mkdirSync(runtimeDir, { recursive: true });

  // Try each variant until one works
  const variants = arch === "aarch64"
    ? [`bun-${platform}-${arch}`]
    : [`bun-${platform}-${arch}-baseline`, `bun-${platform}-${arch}`];

  let lastError: Error | null = null;
  for (const assetName of variants) {
    const assetUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${assetName}.zip`;
    const zipPath = join(runtimeDir, `${assetName}.zip`);
    const extractDir = join(runtimeDir, assetName);
    const extractedBun = join(extractDir, "bun");

    try {
      console.log(`  Source: ${assetUrl}`);
      downloadFile(assetUrl, zipPath);

      import.meta.require?.("node:fs").mkdirSync(extractDir, { recursive: true });

      const unzipResult = Bun.spawnSync(["unzip", "-o", zipPath, "-d", extractDir], {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30_000,
      });
      if (unzipResult.exitCode !== 0) {
        throw new Error("unzip failed");
      }

      Bun.spawnSync(["rm", zipPath], { stdio: ["pipe", "pipe", "pipe"] });

      if (!existsSync(extractedBun)) {
        throw new Error("Bun binary not found after extraction");
      }

      import.meta.require?.("node:fs").chmodSync(extractedBun, 0o755);

      const cachedPath = getCachedBunPath();
      import.meta.require?.("node:fs").renameSync(extractedBun, cachedPath);

      try {
        Bun.spawnSync(["rm", "-rf", extractDir], { stdio: ["pipe", "pipe", "pipe"] });
      } catch { /* best effort */ }

      console.log(`  Cached to ${cachedPath}`);
      return cachedPath;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      try { Bun.spawnSync(["rm", zipPath], { stdio: ["pipe", "pipe", "pipe"] }); } catch { /* may not exist */ }
      try { Bun.spawnSync(["rm", "-rf", extractDir], { stdio: ["pipe", "pipe", "pipe"] }); } catch { /* best effort */ }
    }
  }

  console.error("");
  console.error(`❌  Failed to download Bun ${BUN_VERSION}`);
  console.error(`    ${lastError?.message ?? "Unknown error"}`);
  console.error("");
  console.error("    Install Bun manually: https://bun.sh/docs/installation");
  console.error("    Or set CHRONA_BUN_PATH=/path/to/bun");
  console.error("");
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────
// Spawn Bun entry
// ──────────────────────────────────────────────────────────────

function main() {
  const bunPath = resolveBun();
  const bunEntryPath = resolve(packageDir, BUN_ENTRY);

  if (!existsSync(bunEntryPath)) {
    console.error(`❌  Bun entry not found: ${bunEntryPath}`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const child = Bun.spawn([bunPath, bunEntryPath, ...args], {
    stdio: ["inherit", "inherit", "inherit"],
    cwd: packageDir,
    env: {
      ...process.env,
      CHRONA_PACKAGE_DIR: packageDir,
    },
  });

  const forwardSignal = (signal: string) => {
    child.kill(signal as unknown as number);
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  process.on("SIGHUP", () => forwardSignal("SIGHUP"));

  child.exited.then((exitCode) => {
    process.exit(exitCode ?? 1);
  });
}

main();

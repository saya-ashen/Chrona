#!/usr/bin/env bun
/**
 * README/docs asset pipeline.
 *
 *   bun run scripts/assets.ts capture [--base-url http://127.0.0.1:3100]
 *   bun run scripts/assets.ts import
 *   bun run scripts/assets.ts optimize
 *   bun run scripts/assets.ts check
 *   bun run scripts/assets.ts all
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium, type Browser, type Page } from "playwright";

const ROOT = process.cwd();
const ASSET_DIR = path.join(ROOT, "docs", "assets");
const RAW_DIR = path.join(ASSET_DIR, "raw");
const SOURCE_DIR = path.join(ASSET_DIR, "source");
const GENERATED_DIR = path.join(ASSET_DIR, "generated");
const TMP_DIR = path.join(ASSET_DIR, ".tmp");

const DEFAULT_WEB_PORT = 3170;
const DEFAULT_API_PORT = 3171;
const DEFAULT_WEB_URL = `http://127.0.0.1:${DEFAULT_WEB_PORT}`;
const DEFAULT_API_URL = `http://127.0.0.1:${DEFAULT_API_PORT}`;
const CAPTURE_DATABASE_URL = "file:./docs/assets/.tmp/capture.db";

const IMAGE_ASSETS = [
  {
    name: "task-workspace",
    raw: "task-workspace.png",
    source: "task-workspace.png",
    generated: "task-workspace.png",
    legacy: "TaskWorkSpace.png",
    route: "/en/tasks/graph-fixture-inactive-branch-tail",
    waitFor: "[data-testid='task-plan-graph']",
    maxBytes: 900_000,
    maxWidth: 1600,
  },
  {
    name: "node-detail",
    raw: "node-detail.png",
    source: "node-detail.png",
    generated: "node-detail.png",
    legacy: "NodeDetail.png",
    route: "/en/tasks/graph-fixture-inactive-branch-tail",
    waitFor: "[data-testid='task-plan-graph']",
    maxBytes: 650_000,
    maxWidth: 1600,
  },
] as const;

type Command = "capture" | "import" | "optimize" | "check" | "all" | "help";

type Options = {
  command: Command;
  baseUrl: string | null;
  noStart: boolean;
  headed: boolean;
  keepServer: boolean;
  skipSeed: boolean;
  updateReadme: boolean;
};

function usage() {
  console.log(`Chrona asset pipeline\n\nUsage:\n  bun run scripts/assets.ts capture [--base-url URL] [--no-start] [--headed] [--skip-seed]\n  bun run scripts/assets.ts import\n  bun run scripts/assets.ts optimize [--update-readme]\n  bun run scripts/assets.ts check\n  bun run scripts/assets.ts all\n\nOutputs:\n  docs/assets/raw/*        captured screenshots\n  docs/assets/source/*     normalized inputs\n  docs/assets/generated/*  README-ready assets\n`);
}

function parseArgs(argv: string[]): Options {
  const command = (argv[0] ?? "help") as Command;
  const options: Options = {
    command,
    baseUrl: null,
    noStart: false,
    headed: false,
    keepServer: false,
    skipSeed: false,
    updateReadme: false,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") options.baseUrl = argv[++i] ?? fail("Missing --base-url value");
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length);
    else if (arg === "--no-start") options.noStart = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--keep-server") options.keepServer = true;
    else if (arg === "--skip-seed") options.skipSeed = true;
    else if (arg === "--update-readme") options.updateReadme = true;
    else fail(`Unknown argument: ${arg}`);
  }
  if (!["capture", "import", "optimize", "check", "all", "help"].includes(command)) {
    fail(`Unknown command: ${command}`);
  }
  return options;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function rel(file: string) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function ensureDirs() {
  for (const dir of [ASSET_DIR, RAW_DIR, SOURCE_DIR, GENERATED_DIR, TMP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFileChanged(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to) && fs.readFileSync(from).equals(fs.readFileSync(to))) return false;
  fs.copyFileSync(from, to);
  return true;
}

async function waitForHttp(url: string, label: string, timeoutMs = 30_000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok || res.status < 500) return;
      lastError = `${res.status} ${res.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(500);
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

function startProcess(name: string, cmd: string[], env: Record<string, string>, cwd = ROOT) {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });
  console.log(`[assets:${name}] started pid=${proc.pid}`);
  return proc;
}

async function seedFixtures() {
  const result = spawnSync("bun", ["run", "scripts/seed-plan-graph-fixtures.ts"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: CAPTURE_DATABASE_URL },
    encoding: "utf8",
  });
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.status !== 0) {
    if (result.stderr.trim()) console.error(result.stderr.trim());
    fail("Fixture seed failed");
  }
}

async function withLocalServer<T>(options: Options, fn: (baseUrl: string) => Promise<T>) {
  if (options.baseUrl) return fn(options.baseUrl.replace(/\/$/, ""));
  if (options.noStart) return fn(DEFAULT_WEB_URL);

  ensureDirs();
  const server = startProcess("server", ["bun", "apps/server/src/index.bun.ts"], {
    DATABASE_URL: CAPTURE_DATABASE_URL,
    HOST: "127.0.0.1",
    PORT: String(DEFAULT_API_PORT),
    ALLOWED_ORIGINS: DEFAULT_WEB_URL,
  });
  const web = startProcess(
    "web",
    ["bun", path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(DEFAULT_WEB_PORT)],
    {
      VITE_API_BASE_URL: DEFAULT_API_URL,
      CHRONA_WEB_PORT: String(DEFAULT_WEB_PORT),
    },
    path.join(ROOT, "apps", "web"),
  );

  const cleanup = () => {
    if (!options.keepServer) {
      web.kill();
      server.kill();
    }
  };

  try {
    await waitForHttp(`${DEFAULT_API_URL}/health`, "API server");
    if (!options.skipSeed) await seedFixtures();
    await waitForHttp(DEFAULT_WEB_URL, "web dev server");
    return await fn(DEFAULT_WEB_URL);
  } finally {
    cleanup();
  }
}

function resolveChromiumExecutable() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? process.env.CHROMIUM_PATH;
  if (explicit) return explicit;
  for (const candidate of ["/run/current-system/sw/bin/chromium", "/run/current-system/sw/bin/chromium-browser"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function preparePage(page: Page, url: string, waitFor: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.waitForSelector(waitFor, { timeout: 20_000 });
  await page.waitForTimeout(500);
}

async function captureScreenshots(options: Options) {
  ensureDirs();
  await withLocalServer(options, async (baseUrl) => {
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: !options.headed, executablePath: resolveChromiumExecutable() });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "UTC",
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();

      const hero = IMAGE_ASSETS[0];
      await preparePage(page, `${baseUrl}${hero.route}`, hero.waitFor);
      await page.screenshot({ path: path.join(RAW_DIR, hero.raw), fullPage: false });
      console.log(`captured ${rel(path.join(RAW_DIR, hero.raw))}`);

      const detail = IMAGE_ASSETS[1];
      const commandCenter = page.getByRole("complementary", { name: "Task command center" });
      await commandCenter.screenshot({ path: path.join(RAW_DIR, detail.raw) });
      console.log(`captured ${rel(path.join(RAW_DIR, detail.raw))}`);
    } finally {
      await browser?.close();
    }
  });
}

function importAssets() {
  ensureDirs();
  for (const asset of IMAGE_ASSETS) {
    const rawPath = path.join(RAW_DIR, asset.raw);
    const legacyPath = path.join(ASSET_DIR, asset.legacy);
    const input = fs.existsSync(rawPath) ? rawPath : legacyPath;
    if (!fs.existsSync(input)) fail(`Missing asset input for ${asset.name}: ${rel(rawPath)} or ${rel(legacyPath)}`);
    const out = path.join(SOURCE_DIR, asset.source);
    const changed = copyFileChanged(input, out);
    console.log(`${changed ? "imported" : "unchanged"} ${rel(out)}`);
  }
}

function runMagick(args: string[]) {
  const result = spawnSync("magick", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    if (result.stdout.trim()) console.error(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    fail(`magick failed: magick ${args.join(" ")}`);
  }
  return result.stdout.trim();
}

function optimizeAssets(options: Options) {
  ensureDirs();
  for (const asset of IMAGE_ASSETS) {
    const input = path.join(SOURCE_DIR, asset.source);
    if (!fs.existsSync(input)) fail(`Missing source asset: ${rel(input)}. Run assets:import first.`);
    const output = path.join(GENERATED_DIR, asset.generated);
    runMagick([
      input,
      "-resize",
      `${asset.maxWidth}x${asset.maxWidth}>`,
      "-strip",
      "-define",
      "png:compression-level=9",
      output,
    ]);
    console.log(`optimized ${rel(output)} (${fs.statSync(output).size} bytes)`);
  }
  if (options.updateReadme) updateReadmeReferences();
}

function updateReadmeReferences() {
  const replacements = new Map([
    ["docs/assets/TaskWorkSpace.png", "docs/assets/generated/task-workspace.png"],
    ["docs/assets/NodeDetail.png", "docs/assets/generated/node-detail.png"],
  ]);
  for (const file of ["README.md", "README.zh.md"]) {
    const abs = path.join(ROOT, file);
    let text = fs.readFileSync(abs, "utf8");
    for (const [from, to] of replacements) text = text.replaceAll(from, to);
    fs.writeFileSync(abs, text);
    console.log(`updated ${file}`);
  }
}

type ImageInfo = { width: number; height: number; bytes: number };

function imageInfo(file: string): ImageInfo {
  const stdout = runMagick(["identify", "-format", "%w %h", file]);
  const [width, height] = stdout.split(/\s+/).map(Number);
  return { width, height, bytes: fs.statSync(file).size };
}


function checkAssets() {
  ensureDirs();
  const problems: string[] = [];
  const rootDocs = ["README.md", "README.zh.md"].map((file) => path.join(ROOT, file));
  const docs = rootDocs.filter((file) => fs.existsSync(file));

  for (const file of docs) {
    const text = fs.readFileSync(file, "utf8");
    if (/docs\/assets\/(raw|source)\//.test(text)) problems.push(`${rel(file)} references raw/source assets`);
    if (/docs\/assets\/(TaskWorkSpace|NodeDetail)\.png/.test(text)) problems.push(`${rel(file)} references legacy root screenshots`);
  }

  for (const asset of IMAGE_ASSETS) {
    const generated = path.join(GENERATED_DIR, asset.generated);
    if (!fs.existsSync(generated)) {
      problems.push(`missing generated asset ${rel(generated)}`);
      continue;
    }
    const info = imageInfo(generated);
    if (info.bytes > asset.maxBytes) problems.push(`${rel(generated)} is ${info.bytes} bytes, limit ${asset.maxBytes}`);
    if (info.width > asset.maxWidth) problems.push(`${rel(generated)} width is ${info.width}, limit ${asset.maxWidth}`);
    console.log(`${rel(generated)}: ${info.bytes} bytes, ${info.width}x${info.height}`);
  }

  if (problems.length > 0) {
    console.error("assets check failed");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log("assets check passed");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  switch (options.command) {
    case "capture":
      await captureScreenshots(options);
      break;
    case "import":
      importAssets();
      break;
    case "optimize":
      optimizeAssets(options);
      break;
    case "check":
      checkAssets();
      break;
    case "all":
      await captureScreenshots(options);
      importAssets();
      optimizeAssets({ ...options, updateReadme: true });
      checkAssets();
      break;
    case "help":
      usage();
      break;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

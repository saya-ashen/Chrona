import { existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { createProgram } from "../../common/cli/src/program";

// Resolve package install directory (where the bundle lives)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageDir = resolve(__dirname, "..");

function banner() {
  console.log("⚡ Chrona — AI-native task control plane");
  console.log("");
}

function ensureEnv() {
  const cwd = process.cwd();
  const envPath = resolve(cwd, ".env");
  const examplePath = resolve(packageDir, ".env.example");
  if (existsSync(envPath)) return;
  if (!existsSync(examplePath)) {
    console.log("⚠️  No .env.example found — skipping env setup.");
    return;
  }
  copyFileSync(examplePath, envPath);
  console.log("📋 Created .env from .env.example");
  console.log("   Edit .env to configure API keys: " + envPath);
  console.log("");
}

function ensureDb() {
  const dbUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const dbPath = dbUrl.replace(/^file:/, "");
  const fullPath = resolve(process.cwd(), dbPath);
  if (existsSync(fullPath)) return;

  console.log("🗄️  Initializing database...");
  console.log("   No database found. It will be created on first server start.");
  console.log("   Run 'npx prisma migrate deploy' to set up tables.");
  console.log("");
}

function openBrowser(port: number) {
  const url = `http://localhost:${port}`;
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } else if (platform === "win32") {
      spawn("cmd", ["/c", "start", url], { stdio: "ignore", detached: true }).unref();
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch {
    // best-effort
  }
}

async function startServerMode() {
  banner();
  ensureEnv();
  ensureDb();

  process.env.CHROMA_WEB_DIST = resolve(packageDir, "apps/web/dist");

  const { startNodeServer } = await import("../../../apps/server/src/index");

  const port = Number.parseInt(process.env.PORT ?? "3101", 10);
  console.log(`🚀 Starting Chrona on http://localhost:${port}`);
  console.log("");

  setTimeout(() => {
    openBrowser(port);
  }, 1500);

  await startNodeServer();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] !== "start") {
    await createProgram().parseAsync(process.argv);
    return;
  }

  await startServerMode();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

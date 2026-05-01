#!/usr/bin/env bun

import { existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const appDir = resolve(dirname(import.meta.dirname), "../..");

function banner() {
  console.log("⚡ Chrona — AI-native task control plane");
  console.log("");
}

function ensureEnv() {
  const envPath = resolve(appDir, ".env");
  const examplePath = resolve(appDir, ".env.example");
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
  const fullPath = resolve(appDir, dbPath);
  if (existsSync(fullPath)) return;

  console.log("🗄️  Initializing database...");
  try {
    Bun.spawnSync(["bun", "run", "db:seed"], { cwd: appDir, stdio: ["ignore", "inherit", "inherit"] });
    console.log("✅ Database ready.");
  } catch {
    console.log("⚠️  Database init failed. Run 'bun run setup' manually.");
  }
  console.log("");
}

function startServer() {
  const serverPath = resolve(appDir, "apps/server/src/index.bun.ts");
  const serverProcess = Bun.spawn(["bun", "run", serverPath], {
    cwd: appDir,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      HOST: process.env.HOST ?? "0.0.0.0",
      PORT: process.env.PORT ?? "3101",
    },
  });

  serverProcess.exited.then((code) => {
    process.exit(code ?? 0);
  });

  const handleSignal = () => {
    serverProcess.kill();
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  return serverProcess;
}

function openBrowser(port: number) {
  const url = `http://localhost:${port}`;
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      Bun.spawn(["open", url], { stdio: ["ignore", "ignore", "ignore"] });
    } else if (platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", url], { stdio: ["ignore", "ignore", "ignore"] });
    } else {
      Bun.spawn(["xdg-open", url], { stdio: ["ignore", "ignore", "ignore"] });
    }
  } catch {
    // best-effort
  }
}

async function delegateToCli(args: string[]) {
  const cliPath = resolve(appDir, "packages/common/cli/src/index.ts");
  const proc = Bun.spawn(["bun", "run", cliPath, ...args], {
    cwd: appDir,
    stdio: ["ignore", "inherit", "inherit"],
  });
  await proc.exited;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] !== "start") {
    await delegateToCli(args);
    return;
  }

  banner();

  ensureEnv();
  ensureDb();

  const distIndex = resolve(appDir, "apps/web/dist/index.html");
  if (!existsSync(distIndex)) {
    console.error("❌ Frontend build not found. Run: bun run build");
    process.exit(1);
  }

  const port = Number.parseInt(process.env.PORT ?? "3101", 10);

  console.log(`🚀 Starting Chrona on http://localhost:${port}`);
  console.log("");

  startServer();

  setTimeout(() => {
    openBrowser(port);
  }, 1500);
}

await main();

#!/usr/bin/env bun

const ROOT = import.meta.dirname.replace(/\/scripts$/, "");

function assertSafeDevServerBind() {
  const host = process.env.HOST ?? "127.0.0.1";
  const apiKey = process.env.API_KEY;
  const unsafeOverride = process.env.CHRONA_UNSAFE_PUBLIC_BIND === "1";

  if (host !== "0.0.0.0" || apiKey || unsafeOverride) {
    return;
  }

  console.error(`
╔══════════════════════════════════════════════════════════════════════╗
║ Chrona stopped: unsafe public API bind                              ║
╚══════════════════════════════════════════════════════════════════════╝

HOST=0.0.0.0 exposes the Chrona API to your network, but API_KEY is not set.

Use one of these commands:

  HOST=0.0.0.0 API_KEY=your-access-key bun run dev
  HOST=127.0.0.1 bun run dev

Unsafe override, only if you intentionally want public API access without a key:

  HOST=0.0.0.0 CHRONA_UNSAFE_PUBLIC_BIND=1 bun run dev
`);
  process.exit(1);
}

function spawn(name: string, cmd: string[]) {
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
  });
  console.log(`[${name}] started (pid ${proc.pid})`);
  return proc;
}

assertSafeDevServerBind();

const web = spawn("web", ["bun", "run", "--cwd", "apps/web", "dev", "--host", "0.0.0.0"]);
const server = spawn("server", ["bun", "--watch", "apps/server/src/index.bun.ts"]);

function cleanup() {
  web.kill();
  server.kill();
}

process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });

const exitCode = await Promise.race([
  web.exited.then((code) => ({ name: "web", code })),
  server.exited.then((code) => ({ name: "server", code })),
]);

if (exitCode.code !== 0) {
  console.error(`[${exitCode.name}] exited with code ${exitCode.code}`);
}

cleanup();
process.exit(exitCode.code ?? 0);

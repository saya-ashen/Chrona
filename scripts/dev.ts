#!/usr/bin/env bun

const ROOT = import.meta.dirname.replace(/\/scripts$/, "");

function spawn(name: string, cmd: string[]) {
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
  });
  console.log(`[${name}] started (pid ${proc.pid})`);
  return proc;
}

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

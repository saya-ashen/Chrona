export {};
// Dedicated test harness: loopback only; never start real provider/execution work.
const web = Bun.spawn(["bun", "run", "--cwd", "apps/web", "dev", "--host", "127.0.0.1", "--port", process.env.CHRONA_WEB_PORT ?? "43100"], { stdio: ["ignore", "inherit", "inherit"] });
const server = Bun.spawn(["bun", "apps/server/src/index.bun.ts"], { stdio: ["ignore", "inherit", "inherit"] });
function cleanup() { web.kill(); server.kill(); }
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("SIGINT", () => { cleanup(); process.exit(0); });
const code = await Promise.race([web.exited, server.exited]);
cleanup(); process.exit(code);

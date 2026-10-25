/**
 * Module preview (v2-12): `bun --no-install node_modules/chrona/preview.ts <moduledir> [fixtures.json]` starts the module
 * under the test kernel and serves its HTTP (`chrona.serve`) on http://127.0.0.1:<port>/ until stopped. Routed calls are
 * answered from fixtures.json ({ "<module>.<tool>": output }), else with null, like author tests; nothing real happens.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [dir, fixturesFile] = process.argv.slice(2);
if (!dir) { console.error("Usage: bun --no-install node_modules/chrona/preview.ts <moduledir> [fixtures.json]"); process.exit(2); }
const fixtures = fixturesFile ? JSON.parse(await readFile(resolve(fixturesFile), "utf8")) as Record<string, unknown> : {};
const root = resolve(dir);
process.env.CHRONA_MODULE = root;
process.env.CHRONA_DATA = await mkdtemp(join(tmpdir(), "preview-data-"));
process.env.CHRONA_CONTENT = await mkdtemp(join(tmpdir(), "preview-content-"));
process.chdir(root);
const manifest = JSON.parse(await readFile("module.json", "utf8")) as { entry: string };
// After the environment is set: testing.ts reads it when loaded.
const { startModule } = await import("./testing");
const module = await startModule(manifest.entry, { stubs: Object.fromEntries(Object.entries(fixtures).map(([target, output]) => [target, () => output])) });

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, async fetch(request) {
  const url = new URL(request.url), body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  // The module may still be starting.
  for (let attempt = 0; ; attempt++) {
    try { return await fetch(`http://module${url.pathname}${url.search}`, { unix: module.httpSocket, method: request.method, headers: request.headers, body, redirect: "manual" }); }
    catch { if (attempt >= 50) return new Response("The module is not serving HTTP (does it call chrona.serve?)", { status: 502 }); await Bun.sleep(100); }
  }
} });
console.log(`Preview: http://127.0.0.1:${server.port}/`);
async function stop() { await server.stop(true); await module.stop(); process.exit(0); }
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

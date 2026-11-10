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
const manifest = JSON.parse(await readFile("module.json", "utf8")) as { entry: Parameters<typeof startModule>[0] };
// After the environment is set: testing.ts reads it when loaded.
const { startModule } = await import("./testing");
const module = await startModule(manifest.entry, { stubs: Object.fromEntries(Object.entries(fixtures).map(([target, output]) => [target, () => output])) });

// Wait for the protocol's readiness report; a module without HTTP still gets a bounded preview error.
let readinessTimer: ReturnType<typeof setTimeout>;
const httpReady = Promise.race([
  module.httpReady,
  new Promise<never>((_, reject) => { readinessTimer = setTimeout(() => reject(new Error("Module HTTP readiness timed out")), 5000); }),
]).finally(() => clearTimeout(readinessTimer));
void httpReady.catch(() => {});
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, async fetch(request) {
  const url = new URL(request.url), headers = new Headers(request.headers);
  headers.delete("authorization"); headers.delete("cookie"); headers.delete("x-chrona-module-token");
  try {
    await httpReady;
    const response = await module.fetch(`${url.pathname}${url.search}`, { method: request.method, headers, body: request.body, signal: request.signal });
    const out = new Headers(response.headers);
    // Modules cannot overwrite browser credentials on the preview's origin.
    out.delete("set-cookie"); out.delete("x-chrona-module-token");
    return new Response(response.body, { status: response.status, headers: out });
  } catch { return new Response("The module is not serving HTTP (does it call chrona.serve?)", { status: 502 }); }
} });
console.log(`Preview: http://127.0.0.1:${server.port}/`);
async function stop() { await server.stop(true); await module.stop(); process.exit(0); }
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

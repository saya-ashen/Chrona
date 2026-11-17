import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const root = import.meta.dirname, checkout = resolve(root, "../..");
process.env.CHRONA_MODULE = root;
process.env.CHRONA_SDK ??= join(checkout, "packages/app-sdk");
process.env.CHRONA_PROCESS_HELPER ??= join(checkout, `packages/process/bin/${process.platform}-${process.arch}/chrona-process-guardian`);
const temp = await mkdtemp(join(tmpdir(), "chrona-desktop-preview-"));
process.env.CHRONA_DATA = join(temp, "data"); process.env.CHRONA_CONTENT = join(temp, "content");
await mkdir(process.env.CHRONA_DATA); await mkdir(process.env.CHRONA_CONTENT);
const { startModule } = await import(join(process.env.CHRONA_SDK, "testing.ts")) as typeof import("../../packages/app-sdk/testing");
const manifest = await Bun.file(join(root, "module.json")).json();
const runtime = await startModule(manifest.entry);
const input = createInterface({ input: process.stdin, terminal: false });
const interrupt = () => input.close();
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
console.log("Temporary SDK preview. Commands: open, status, close, quit. No installation or database.");
try {
  for await (const line of input) {
    const id = line.trim();
    if (id === "quit") break;
    if (!["open", "close", "status"].includes(id)) { console.log("Use open, status, close or quit"); continue; }
    const now = new Date().toISOString();
    console.log(JSON.stringify(await runtime.send({ trigger: { kind: "tool", id, args: {}, firedAt: now }, now, params: {} })));
  }
} finally {
  input.close(); process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  await runtime.stop();
  console.log("Supervisor confirmed descendant-empty stop");
  await rm(temp, { recursive: true, force: true });
}

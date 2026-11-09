import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeBuildHelpers } from "../../module-build-helpers";

for (const name of ["web", "mcp"]) test(`${name} stage 5/6/7 SDK author test`, async () => {
  const root = await mkdtemp("/tmp/chrona-stages567-author-");
  try {
    const sdk = resolve(import.meta.dir, "../../../../../../integrations/src/steward/module-sdk");
    await writeBuildHelpers(root, sdk, { calls: {}, typecheck: resolve(import.meta.dir, "../../../../../../integrations/src/steward/module-typecheck") });
    const code = join(root, name), data = join(root, "data"), content = join(root, "content");
    await cp(resolve(import.meta.dir, name === "web" ? "." : "../../external/mcp"), code, { recursive: true });
    await mkdir(data); await mkdir(content);
    const clock = join(root, "clock.js");
    await writeFile(clock, `const RealDate = Date; const fixed = RealDate.parse("2026-11-08T00:00:00Z"); globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };`);
    const child = Bun.spawn([process.execPath, "--no-install", "test.ts"], { cwd: code, env: { ...process.env, BUN_OPTIONS: `${process.env.BUN_OPTIONS ?? ""} --preload ${clock}`, CHRONA_MODULE: code, CHRONA_DATA: data, CHRONA_CONTENT: content, DATABASE_URL: `file:${join(root, "test.sqlite")}`, CHRONA_NOW: "2026-11-08T00:00:00Z" }, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text(), error = await new Response(child.stderr).text();
    expect(await child.exited, output + error).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120_000);

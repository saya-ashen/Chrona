import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeBuildHelpers } from "../../module-build-helpers";

test("Events SDK author test uses registered publishers and only directory APIs", async () => {
  const root = await mkdtemp("/tmp/chrona-events-author-");
  try {
    const sdk = resolve(import.meta.dir, "../../../../../../integrations/src/steward/module-sdk");
    await writeBuildHelpers(root, sdk, { calls: await readFile(join(sdk, "calls.d.ts"), "utf8") });
    const code = join(root, "events"), data = join(root, "data"), content = join(root, "content");
    await cp(import.meta.dir, code, { recursive: true });
    await mkdir(data); await mkdir(content);
    const child = Bun.spawn([process.execPath, "--no-install", "test.ts"], {
      cwd: code,
      env: { ...process.env, CHRONA_MODULE: code, CHRONA_DATA: data, CHRONA_CONTENT: content, DATABASE_URL: `file:${join(root, "test.sqlite")}` },
      stdout: "pipe", stderr: "pipe",
    });
    const [output, error, codeResult] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(codeResult, output + error).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

for (const scenario of ["source", "artifact", "invalid"]) test(`Pi ${scenario} runtime uses ordinary registration and structured kernel tools with a fake adapter`, async () => {
  const data = await mkdtemp("/tmp/chrona-pi-runtime-");
  try {
    const child = Bun.spawn([process.execPath, "run", join(import.meta.dir, "runtime.fixture.ts"), scenario], {
      env: { ...process.env, CHRONA_DATA: data }, stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
  } finally { await rm(data, { recursive: true, force: true }); }
});

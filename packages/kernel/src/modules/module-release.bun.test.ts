import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveExternalRelease } from "./module-release";
import { seedTestModuleRelease } from "../__testing__/module-release-test-fixture";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-release-")); roots.push(root);
  const resources = join(root, "external"), code = join(resources, "fixture");
  await mkdir(code, { recursive: true });
  await writeFile(join(code, "module.json"), JSON.stringify({ name: "fixture", entry: "index.ts", keepAlive: true, effects: [] }));
  await writeFile(join(code, "index.ts"), "export {};\n");
  const release = await seedTestModuleRelease(resources, "fixture");
  return { root, code, release, ports: { moduleExternalResources: resources } };
}
test("offline interpreted release uses full SHA256 material identity without Git", async () => {
  const f = await fixture(), release = await resolveExternalRelease(f.ports, "fixture");
  expect(release.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(release.hash).toBe(f.release.hash);
  expect(release).not.toHaveProperty("git");
});
test.each(["bytes", "mode"])("release selection detects source %s drift", async kind => {
  const f = await fixture();
  if (kind === "bytes") await writeFile(join(f.code, "index.ts"), "changed");
  else await chmod(join(f.code, "index.ts"), 0o755);
  await expect(resolveExternalRelease(f.ports, "fixture", f.release.hash)).rejects.toMatchObject({ reason: "release_drift" });
});
test("missing record and undeclared files have no legacy layout fallback", async () => {
  const f = await fixture();
  await writeFile(join(f.code, "extra.ts"), "unbound");
  await expect(resolveExternalRelease(f.ports, "fixture")).rejects.toMatchObject({ reason: "release_drift" });
  await rm(join(f.code, "extra.ts"));
  await rm(join(f.code, "chrona-material.json"));
  await expect(resolveExternalRelease(f.ports, "fixture")).rejects.toMatchObject({ reason: "invalid_release" });
});
test("release directories and selected files reject symlinks", async () => {
  const f = await fixture();
  await rm(join(f.code, "index.ts"));
  await symlink(join(f.code, "module.json"), join(f.code, "index.ts"));
  await expect(resolveExternalRelease(f.ports, "fixture")).rejects.toMatchObject({ reason: "invalid_release" });
  await symlink(f.code, join(f.ports.moduleExternalResources, "other"));
  await expect(resolveExternalRelease(f.ports, "other")).rejects.toMatchObject({ reason: "invalid_release" });
});

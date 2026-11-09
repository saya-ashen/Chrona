import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { resolveBuiltinRelease, resolveExternalRelease } from "./module-release";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { readModuleFiles } from "./module-preview";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(name = "files") {
  const root = await mkdtemp(join(tmpdir(), "chrona-release-test-")); roots.push(root);
  const resources = join(root, "external"), codeDir = join(resources, name); await mkdir(codeDir, { recursive: true });
  await writeFile(join(codeDir, "module.json"), JSON.stringify(moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] })));
  await writeFile(join(codeDir, "index.ts"), "// release\n");
  await writeFile(join(codeDir, "test.ts"), "// test\n");
  const git = await seedTestModuleRelease(resources, name);
  return { root, resources, codeDir, git, ports: { moduleExternalResources: resources } };
}
test.each(["files", "author", "coding", "coding-web"])("offline %s release identity is its real commit with no invented upstream", async name => {
  const f = await fixture(name), release = await resolveExternalRelease(f.ports, name);
  expect(release.hash).toBe(f.git.commit);
  expect(release.git).toEqual({ repository: null, branch: "main", commit: f.git.commit, bundlePath: f.git.bundlePath });
});
test.each(["files", "events", "web", "notify"])("extracted official %s still verifies registered legacy approval hashes", async name => {
  const f = await fixture(name), digest = createHash("sha256");
  for (const file of (await readModuleFiles(f.codeDir, "Unsafe legacy fixture")).sort((a, b) => a.path.localeCompare(b.path))) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  const hash = digest.digest("hex");
  expect(await resolveExternalRelease(f.ports, name, hash)).toMatchObject({ name, origin: "external", hash, git: null });
  await writeFile(join(f.codeDir, "index.ts"), "// changed after approval\n");
  await expect(resolveExternalRelease(f.ports, name, hash)).rejects.toMatchObject({ reason: "release_drift" });
});
test.each(["files", "author", "coding", "coding-web"])("%s bundle integrity and source commit drift both fail closed", async name => {
  const f = await fixture(name);
  await writeFile(join(f.codeDir, "index.ts"), "// drift\n");
  await expect(resolveExternalRelease(f.ports, name)).rejects.toMatchObject({ reason: "release_drift" });
  await writeFile(join(f.codeDir, "index.ts"), "// release\n");
  await appendFile(f.git.bundlePath, "tampered");
  await expect(resolveExternalRelease(f.ports, name)).rejects.toMatchObject({ reason: "release_drift" });
});
test.each(["files", "author", "coding", "coding-web"])("new %s release has no snapshot fallback when lock is missing or ambiguous", async name => {
  const f = await fixture(name), lockPath = join(f.root, "module-git", "lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.modules.push(lock.modules[0]); await writeFile(lockPath, JSON.stringify(lock));
  await expect(resolveExternalRelease(f.ports, name)).rejects.toMatchObject({ reason: "invalid_release" });
  await rm(lockPath);
  await expect(resolveExternalRelease(f.ports, name)).rejects.toMatchObject({ reason: "release_not_found" });
});
test("bundle symlink rejected and legacy reader keeps original approval hash", async () => {
  const f = await fixture(), backup = join(f.root, "bundle-copy");
  await writeFile(backup, await readFile(f.git.bundlePath)); await rm(f.git.bundlePath); await symlink(backup, f.git.bundlePath);
  await expect(resolveExternalRelease(f.ports, "files")).rejects.toMatchObject({ reason: "invalid_release" });
  const dir = join(f.root, "builtin", "agent"); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "module.json"), JSON.stringify(moduleManifestSchema.parse({ name: "agent", entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] })));
  await writeFile(join(dir, "index.ts"), "// legacy\n");
  await writeFile(join(dir, "test.ts"), "// legacy test\n");
  const digest = createHash("sha256");
  for (const file of (await readModuleFiles(dir, "Unsafe legacy fixture")).sort((a, b) => a.path.localeCompare(b.path))) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  const hash = digest.digest("hex");
  expect(await resolveBuiltinRelease({ moduleBuiltinResources: join(f.root, "builtin") }, "agent", hash)).toMatchObject({ hash, git: null });
});

import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutModule, snapshotModule } from "./module-files";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-files-")); roots.push(root);
  await mkdir(join(root, "module"));
  await writeFile(join(root, "module", "index.ts"), "export {};");
  await writeFile(join(root, "module", "module.json"), "{}");
  return root;
}
test("module snapshots and checkout use an explicit session/build root without git", async () => {
  const root = await fixture(), files = await snapshotModule(root, "module");
  expect(files.map(file => file.path)).toEqual(["index.ts", "module.json"]);
  await checkoutModule(root, "copy", files);
  expect(await readFile(join(root, "copy", "index.ts"), "utf8")).toBe("export {};");
  await expect(checkoutModule(root, "copy", files)).rejects.toMatchObject({ code: "conflict" });
});
for (const path of ["../escape", "/outside", "module/../module", "module\\index.ts", ".git"]) test(`rejects unsafe module path ${path}`, async () => {
  await expect(snapshotModule(await fixture(), path)).rejects.toMatchObject({ code: "invalid" });
});
test("snapshots reject symlinks and oversized files", async () => {
  const root = await fixture();
  await symlink(join(root, "module", "index.ts"), join(root, "module", "link.ts"));
  await expect(snapshotModule(root, "module")).rejects.toMatchObject({ code: "forbidden" });
  await rm(join(root, "module", "link.ts"));
  await writeFile(join(root, "module", "large.bin"), new Uint8Array(1024 * 1024 + 1));
  await expect(snapshotModule(root, "module")).rejects.toMatchObject({ code: "invalid" });
});

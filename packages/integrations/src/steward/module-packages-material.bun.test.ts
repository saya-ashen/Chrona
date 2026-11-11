import { expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleMaterialDigest, snapshotModuleMaterial } from "../../../engine/src/modules/steward/module-artifacts";
import { createModulePackages } from "./module-packages";

test("local vendored material keeps single-link files through dependency preparation", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-packages-material-")), dir = join(root, "module");
  const vendor = join(dir, "vendor/dep"), installed = join(dir, "node_modules/dep"), executable = join(root, "dependency-fixture");
  const which = spyOn(Bun, "which").mockReturnValue(executable);
  try {
    await mkdir(vendor, { recursive: true });
    const source = {
      "module.json": JSON.stringify({ name: "fixture", entry: "index.ts" }),
      "index.ts": "export {};",
      "package.json": JSON.stringify({ name: "fixture", dependencies: { dep: "file:vendor/dep" } }),
      "bun.lock": "frozen fixture lock",
    };
    const artifacts = { "vendor/dep/package.json": '{"name":"dep","version":"1.0.0","main":"index.js"}', "vendor/dep/index.js": "module.exports = 42;" };
    for (const [path, bytes] of Object.entries({ ...source, ...artifacts })) await writeFile(join(dir, path), bytes);
    await writeFile(join(dir, "chrona-material.json"), JSON.stringify({ schema: 1, source: Object.keys(source), artifacts: Object.entries(artifacts).map(([path, bytes]) => ({ path, sha256: createHash("sha256").update(bytes).digest("hex") })), build: { commands: ["fixture"], toolchain: "fixture", target: "bun" } }));
    const original = moduleMaterialDigest(await snapshotModuleMaterial(root, "module", { verifyTree: true }));
    // This is the unsafe topology produced by Bun's default file: dependency backend.
    await mkdir(installed, { recursive: true });
    await link(join(vendor, "index.js"), join(installed, "index.js"));
    await expect(snapshotModuleMaterial(root, "module", { verifyTree: true })).rejects.toMatchObject({ code: "forbidden", message: "Unsafe module file" });
    await rm(join(dir, "node_modules"), { recursive: true });
    // A local process fixture models the backend choice; it never invokes a package manager.
    await writeFile(executable, `#!${process.execPath}
import { copyFile, link, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
const args = process.argv.slice(2);
if (!args.includes("--frozen-lockfile") || !args.includes("--ignore-scripts")) process.exit(2);
const copy = args.includes("--backend=copyfile") ? copyFile : link;
const vendor = join(process.cwd(), "vendor/dep"), installed = join(process.cwd(), "node_modules/dep");
await mkdir(installed, { recursive: true });
for (const name of await readdir(vendor)) await copy(join(vendor, name), join(installed, name));
`);
    await chmod(executable, 0o755);
    expect(await createModulePackages().install({ dir, packages: [] })).toEqual({ errors: [], installed: { npm: true, python: false, packages: {} } });
    expect(moduleMaterialDigest(await snapshotModuleMaterial(root, "module", { verifyTree: true }))).toBe(original);
    for (const path of Object.keys(artifacts)) expect((await stat(join(dir, path))).nlink).toBe(1);
    expect(await readFile(join(dir, "bun.lock"), "utf8")).toBe(source["bun.lock"]);
    await writeFile(join(installed, "index.js"), "changed installed dependency");
    expect(await readFile(join(vendor, "index.js"), "utf8")).toBe(artifacts["vendor/dep/index.js"]);
    expect(moduleMaterialDigest(await snapshotModuleMaterial(root, "module", { verifyTree: true }))).toBe(original);
  } finally { which.mockRestore(); await rm(root, { recursive: true, force: true }); }
});

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";

const root = import.meta.dirname;
// Probe with the same interpreter as the helper: installed libraries can have
// incompatible architecture/glibc versions. Each probe gets a fresh process.
let candidates = process.env.CHRONA_DEMO_GTK_LIBRARY ? [resolve(process.env.CHRONA_DEMO_GTK_LIBRARY)] : [
  "/usr/lib/x86_64-linux-gnu/libgtk-4.so.1", "/usr/lib64/libgtk-4.so.1", "/usr/lib/libgtk-4.so.1",
];
if (!process.env.CHRONA_DEMO_GTK_LIBRARY && existsSync("/nix/store")) {
  const names = (await readdir("/nix/store")).filter(name => /-gtk4-[0-9]/.test(name)).sort();
  candidates = candidates.concat(names.map(name => `/nix/store/${name}/lib/libgtk-4.so.1`));
}
const gtkLibrary = candidates.filter(existsSync).find(path => spawnSync("python3", ["-c", "import ctypes,sys; ctypes.CDLL(sys.argv[1])", path], { stdio: "ignore", timeout: 3000 }).status === 0);
if (!gtkLibrary) throw new Error("Python 3 and a compatible GTK 4 library required; set CHRONA_DEMO_GTK_LIBRARY to a loadable absolute libgtk-4.so.1 path");
await mkdir(join(root, "dist"), { recursive: true });
// Bun's readable source labels use cwd even when root is explicit. This standalone
// build process must emit the same labels from a checkout or an exported directory.
process.chdir(root);
const result = await Bun.build({ root, entrypoints: [join(root, "entry.ts")], outdir: join(root, "dist"), target: "bun", format: "esm", minify: false });
if (!result.success) throw new AggregateError(result.logs, "Desktop demo build failed");
await writeFile(join(root, "dist/backend.json"), JSON.stringify({ gtkLibrary }, null, 2) + "\n");
const source = [".gitignore", "README.md", "build.ts", "desktop-window.py", "entry.ts", "main.ts", "module.json", "test.ts", "desktop-demo.bun.test.ts", "check.ts", "preview.ts"];
const artifacts = await Promise.all(["dist/entry.js", "dist/backend.json"].map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(root, path))).digest("hex"), executable: false })));
const build = { commands: ["bun --no-install run build.ts"], toolchain: `Bun ${Bun.version}; Python 3 stdlib ctypes; GTK 4 C ABI`, target: `${process.platform}-${process.arch}; GTK library ${gtkLibrary}` };
await writeFile(join(root, "chrona-material.json"), JSON.stringify({ schema: 1, source, artifacts, build }, null, 2) + "\n");
await writeFile(join(root, "dist/author-import.json"), JSON.stringify({ from: root, to: "sources/desktop-demo-v1", source, artifacts: artifacts.map(({ path, executable }) => ({ path, executable })), build }, null, 2) + "\n");
console.log(`Built dist/entry.js with GTK ${gtkLibrary}\nAuthor import selection: ${join(root, "dist/author-import.json")}`);

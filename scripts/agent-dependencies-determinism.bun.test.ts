import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalizeModuleChunks } from "../build/agent-dependencies";

async function snapshot(dir: string) {
  return Promise.all((await readdir(dir, { recursive: true, withFileTypes: true })).filter(file => file.isFile()).map(async file => {
    const path = join(file.parentPath, file.name);
    return [relative(dir, path), await readFile(path, "utf8")] as const;
  })).then(files => files.sort(([a], [b]) => a.localeCompare(b)));
}

test("two split builds retain identical paths and bytes despite different Bun chunk names", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-chunk-build-"));
  try {
    await writeFile(join(root, "shared.ts"), 'export const state = { value: 42 };');
    await writeFile(join(root, "lazy.ts"), 'import { state } from "./shared"; export const value = state.value + 1;');
    await writeFile(join(root, "first.ts"), 'import { state } from "./shared"; export { state }; export const lazy = () => import("./lazy");');
    await writeFile(join(root, "second.ts"), 'export { state } from "./shared"; export const lazy = () => import("./lazy");');
    const builds = [];
    for (const name of ["one", "two"]) {
      const outdir = join(root, name);
      const built = await Bun.build({ entrypoints: [join(root, "first.ts"), join(root, "second.ts")], target: "bun", minify: true, splitting: true, outdir, naming: { entry: "[name].js", chunk: `chunk-${name}-[hash].js` } });
      expect(built.success).toBe(true);
      expect(built.outputs.filter(output => output.kind === "chunk").length).toBeGreaterThanOrEqual(2);
      builds.push({ outdir, outputs: built.outputs });
    }
    expect(await snapshot(builds[0]!.outdir)).not.toEqual(await snapshot(builds[1]!.outdir));
    for (const build of builds) await canonicalizeModuleChunks(build.outputs);
    expect(await snapshot(builds[0]!.outdir)).toEqual(await snapshot(builds[1]!.outdir));
    for (const build of builds) {
      const first = await import(pathToFileURL(join(build.outdir, "first.js")).href);
      const second = await import(pathToFileURL(join(build.outdir, "second.js")).href);
      expect(first.state).toBe(second.state);
      expect((await first.lazy()).value).toBe(43);
      expect((await second.lazy()).value).toBe(43);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("identical lazy modules keep independent state and repeated imports keep sharing across split builds", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-chunk-identity-"));
  try {
    const module = "let count = 0; export const next = () => ++count;";
    await writeFile(join(root, "left.ts"), module);
    await writeFile(join(root, "right.ts"), module);
    await writeFile(join(root, "entry.ts"), 'export const left = () => import("./left"); export const right = () => import("./right"); export const again = () => import("./left");');
    const snapshots = [];
    for (const name of ["one", "two"]) {
      const outdir = join(root, name);
      const built = await Bun.build({ entrypoints: [join(root, "entry.ts")], target: "bun", minify: true, splitting: true, outdir, naming: { entry: "[name].js", chunk: `chunk-${name}-[hash].js` } });
      expect(built.success).toBe(true);
      const chunks = built.outputs.filter(output => output.kind === "chunk");
      expect(chunks).toHaveLength(2);
      expect(await readFile(chunks[0]!.path, "utf8")).toBe(await readFile(chunks[1]!.path, "utf8"));
      // Neither build output enumeration nor Bun's random names define identity.
      await canonicalizeModuleChunks(name === "one" ? built.outputs : [...built.outputs].reverse());
      snapshots.push(await snapshot(outdir));
      const entry = await import(pathToFileURL(join(outdir, "entry.js")).href);
      const left = await entry.left(), right = await entry.right();
      expect(left).not.toBe(right);
      expect(left.next()).toBe(1);
      expect(right.next()).toBe(1);
      const again = await entry.again();
      expect(again).toBe(left);
      expect(again.next()).toBe(2);
      expect(right.next()).toBe(2);
    }
    expect(snapshots[0]).toEqual(snapshots[1]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("dependent chunks rewrite only import, re-export and dynamic import specifiers", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-chunk-imports-"));
  try {
    for (const suffix of ["old-a", "old-b"]) {
      const dir = join(root, suffix);
      await mkdir(join(dir, "nested"), { recursive: true });
      const leaf = `chunk-leaf-${suffix}.js`, parent = `chunk-parent-${suffix}.js`;
      await writeFile(join(dir, leaf), "export const value = 7;\n");
      await writeFile(join(dir, parent), `export { value } from './${leaf}';\n`);
      await writeFile(join(dir, "nested/entry.js"), `import { value } from '../${parent}'; export { value }; export const lazy = () => import('../${parent}'); export const data = "chunk-leaf-old-a.js"; // ../chunk-parent-old-a.js\n`);
      await canonicalizeModuleChunks([
        { path: join(dir, leaf), kind: "chunk" }, { path: join(dir, parent), kind: "chunk" }, { path: join(dir, "nested/entry.js"), kind: "entry-point" },
      ]);
      const entry = await import(pathToFileURL(join(dir, "nested/entry.js")).href);
      expect(entry.value).toBe(7);
      expect((await entry.lazy()).value).toBe(7);
      expect(entry.data).toBe("chunk-leaf-old-a.js");
    }
    expect(await snapshot(join(root, "old-a"))).toEqual(await snapshot(join(root, "old-b")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cyclic chunks report the dependency path before mutating emitted files", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-chunk-cycle-"));
  try {
    await writeFile(join(root, "a.js"), 'export * from "./b.js";');
    await writeFile(join(root, "b.js"), 'export * from "./a.js";');
    const before = await snapshot(root);
    await expect(canonicalizeModuleChunks(["a.js", "b.js"].map(name => ({ path: join(root, name), kind: "chunk" })))).rejects.toThrow(/cyclic module chunks: .*a\.js -> .*b\.js -> .*a\.js/);
    expect(await snapshot(root)).toEqual(before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

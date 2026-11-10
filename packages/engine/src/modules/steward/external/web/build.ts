// Builds src/pages.tsx (React + json-render for system and registered app pages) into the shipped pages.js.
// Run `bun build.ts` after changing src/ or catalog.ts; committed artifacts need no installation build step.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
// This build script is part of the exported source: it must run without the Chrona repository.
// The release packager validates the generated record against the shared host contract.
const MODULE_MATERIAL_FILE = "chrona-material.json", MODULE_SOURCE_MAX_BYTES = 1024 * 1024;
function isModuleMaterialPath(path: string) {
  return path.length <= 1024 && !/[\\\\:\p{Cc}]/u.test(path) && !path.split("/").some(part => !part || part === "." || part === ".." || part === ".git");
}

// Helper-only mode deliberately leaves browser artifacts and their material record untouched.
// Its validators come from this checkout; the emitted .mjs can then travel independently.
if (process.argv[2] === "--registration-test-only") {
  if (process.argv.length !== 4) throw new Error("Usage: bun build.ts --registration-test-only /absolute/support-directory");
  const { buildRegistrationTest } = await import("./registration-test-build");
  console.log(await buildRegistrationTest(process.argv[3]!));
} else {
  await buildWeb();
}

async function buildWeb() {
  const root = import.meta.dirname;
  const result = await Bun.build({ entrypoints: [join(root, "src/pages.tsx")], target: "browser", format: "esm", minify: true, define: { "process.env.NODE_ENV": '"production"' } });
  if (!result.success) throw new Error(result.logs.join("\n"));
  await Bun.write(join(root, "pages.js"), `// Built from src/pages.tsx by build.ts; do not edit.\n${(await result.outputs[0]!.text()).replace(/[\t ]+$/gm, "")}`);

  // Build the same-origin stylesheet entirely from maintained sources under the Web CSP.
  const base = (await Bun.file(join(root, "src/base.css")).text()).trimEnd();
  await Bun.write(join(root, "style.css"), `${base}\n\n${(await Bun.file(join(root, "src/pages.css")).text()).trimEnd()}\n\n${(await Bun.file(join(root, "shell.css")).text()).trimEnd()}\n`);

  // Keep all maintained source, including locks, tests and build inputs; these are the browser artifacts.
  // Build portable registration support into a separate directory with --registration-test-only.
  const artifactPaths = ["pages.js", "style.css"];
  const ignored = new Set([".git", "node_modules", ".venv", ".chrona"]);
  const source: string[] = [];
  let sourceBytes = 0;
  async function collectSource(relative = "") {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      if (!relative && (ignored.has(entry.name) || entry.name === MODULE_MATERIAL_FILE || artifactPaths.includes(entry.name))) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (!isModuleMaterialPath(path)) throw new Error(`Unsafe Web material path: ${path}`);
      if (entry.isDirectory()) await collectSource(path);
      else if (entry.isFile()) {
        source.push(path);
        sourceBytes += (await lstat(join(root, path))).size;
      } else throw new Error(`Web material must contain regular files and directories only: ${path}`);
    }
  }
  await collectSource();
  const artifacts = [];
  for (const path of artifactPaths) {
    const bytes = await readFile(join(root, path)), stat = await lstat(join(root, path));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe Web artifact: ${path}`);
    artifacts.push({ path, sha256: createHash("sha256").update(bytes).digest("hex"), executable: !!(stat.mode & 0o111) });
  }
  if (!source.includes("module.json") || source.length > 199) throw new Error("Invalid Web source selection");
  const record = {
    schema: 1, source: source.sort((a, b) => a.localeCompare(b)), artifacts,
    build: { commands: ["bun run build.ts"], toolchain: `Bun ${Bun.version}`, target: "browser" },
  };
  const bytes = JSON.stringify(record, null, 2) + "\n";
  if (sourceBytes + Buffer.byteLength(bytes) > MODULE_SOURCE_MAX_BYTES) throw new Error("Web source and material record exceed 1 MiB");
  await Bun.write(join(root, MODULE_MATERIAL_FILE), bytes);
}

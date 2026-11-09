import { builtinModules } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";

/** Build-time only: keep the builtin's host type dependencies available in compiled binaries. */
export function builtinTypecheckMaterial(): Record<string, string> {
  const root = resolve(import.meta.dir, "../../../../.."), files: Record<string, string> = {};
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
  const options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, preserveSymlinks: true };
  function collect(file: string) {
    const path = relative(root, file);
    if (isAbsolute(path) || path.startsWith("../")) throw new Error(`Builtin type dependency is outside the source tree: ${file}`);
    if (Object.hasOwn(files, path)) return;
    const source = readFileSync(file, "utf8");
    files[path] = source;
    // Package exports are part of TypeScript resolution, including workspace packages and zod.
    for (let dir = dirname(file); dir !== root; dir = dirname(dir)) {
      const manifest = join(dir, "package.json");
      if (existsSync(manifest)) files[relative(root, manifest)] = readFileSync(manifest, "utf8");
    }
    for (const dependency of ts.preProcessFile(source, true).importedFiles) {
      if (builtins.has(dependency.fileName)) continue;
      const resolved = ts.resolveModuleName(dependency.fileName, file, options, ts.sys).resolvedModule;
      if (!resolved) throw new Error(`Missing builtin type dependency ${dependency.fileName} in ${file}`);
      // Node/Bun declarations already ship with the module checker.
      if (resolved.resolvedFileName.includes("/node_modules/@types/") || resolved.resolvedFileName.includes("/node_modules/bun-types/")) continue;
      collect(resolved.resolvedFileName);
    }
  }
  for (const name of ["pi-provider", "browser", "pi-launch", "transcript-redaction"]) collect(join(root, `packages/integrations/src/steward/${name}.ts`));
  return files;
}

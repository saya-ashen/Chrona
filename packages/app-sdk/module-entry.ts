import { accessSync, constants, lstatSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";

// The copied SDK has no dependency on Chrona's host packages. This input also accepts the shared manifest contract.
export type ExplicitModuleEntry = { path: string; args?: string[]; runtime?: string };

/** Resolve only regular module files, rejecting symlinks in every module-relative component. */
export function moduleEntryFile(codeDir: string, path: string): string {
  if (!path || path.length > 1024 || path.startsWith("/") || /[\\:\p{Cc}]/u.test(path)
    || path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) throw new Error("Invalid module entry path");
  const code = realpathSync(codeDir);
  let file = code;
  const parts = path.split("/");
  for (const [index, part] of parts.entries()) {
    file = join(file, part);
    const info = lstatSync(file);
    if (info.isSymbolicLink() || (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())) throw new Error("Module entry must be a confined regular file without symlinks");
  }
  const canonical = realpathSync(file);
  if (!canonical.startsWith(code + sep)) throw new Error("Module entry escapes its module directory");
  return canonical;
}

/** Explicit argv is passed directly to the OS; a runtime is a host program name, never a shell command. */
export function explicitModuleCommand(codeDir: string, entry: ExplicitModuleEntry): { program: string; argv: string[] } {
  const args = entry.args ?? [];
  if (!Array.isArray(args) || args.length > 32 || args.some(arg => typeof arg !== "string" || arg.length > 2048 || arg.includes("\0"))) throw new Error("Invalid module entry arguments");
  const file = moduleEntryFile(codeDir, entry.path);
  if (entry.runtime !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(entry.runtime)) throw new Error("Invalid module runtime program name");
    const program = Bun.which(entry.runtime);
    if (!program || !statSync(program).isFile()) throw new Error(`Required host program unavailable: ${entry.runtime}`);
    accessSync(program, constants.X_OK);
    return { program, argv: [...args, file] };
  }
  if (process.platform !== "win32" && !(statSync(file).mode & 0o111)) throw new Error("Native module entry is not executable");
  accessSync(file, constants.X_OK);
  return { program: file, argv: [...args] };
}

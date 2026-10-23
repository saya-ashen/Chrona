import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { StewardError } from "./errors";

async function confined(root: string, path: string, parents = false) {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === ".." || part === ".git")) throw new StewardError("invalid", "Invalid module path");
  const base = resolve(root);
  if (await realpath(base) !== base) throw new StewardError("forbidden", "Unsafe module root");
  let current = base;
  for (const [index, part] of path.split("/").entries()) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (index === path.split("/").length - 1) return current;
      if (!parents) throw error;
      await mkdir(current); info = await lstat(current);
    }
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink !== 1) || !(await realpath(current)).startsWith(base + sep)) throw new StewardError("forbidden", "Unsafe module file");
  }
  return current;
}
/** Installed by Chrona at build time (v2-6), never submitted, hashed or shown in diffs. */
export const INSTALLED_DIRS = new Set(["node_modules", ".venv", ".chrona"]);
export async function snapshotModule(root: string, path: string) {
  const files: { path: string; bytes: Uint8Array }[] = [];
  let total = 0;
  async function walk(path: string, relative: string): Promise<void> {
    const target = await confined(root, path), info = await lstat(target);
    if (info.isDirectory()) {
      for (const entry of await readdir(target)) if (relative || !INSTALLED_DIRS.has(entry)) await walk(`${path}/${entry}`, relative ? `${relative}/${entry}` : entry);
      return;
    }
    if (files.length >= 200 || total + info.size > 1024 * 1024) throw new StewardError("invalid", "Module exceeds file limits");
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw new StewardError("forbidden", "Unsafe module file");
      const bytes = Buffer.alloc(1024 * 1024 - total + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, null);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      total += length;
      if (total > 1024 * 1024) throw new StewardError("invalid", "Module exceeds file limits");
      files.push({ path: relative, bytes: bytes.subarray(0, length) });
    } finally { await handle.close(); }
  }
  if (!(await lstat(await confined(root, path))).isDirectory()) throw new StewardError("invalid", "Module must be a directory");
  await walk(path, "");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function checkoutModule(root: string, path: string, files: { path: string; bytes: Uint8Array }[]) {
  const target = await confined(root, path, true);
  try {
    if (!(await lstat(target)).isDirectory() || (await readdir(target)).length) throw new StewardError("conflict", "Checkout directory must be empty");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(target);
  }
  for (const file of files) {
    const destination = await confined(root, `${path}/${file.path}`, true);
    const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    try { await handle.writeFile(file.bytes); } finally { await handle.close(); }
  }
}

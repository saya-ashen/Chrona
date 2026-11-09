import { lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { workspaceDigest as localDigest } from "./digest";

export function localDirectoryIdentity(path: string) {
  const canonicalPath = realpathSync(path), stat = statSync(canonicalPath, { bigint: true });
  if (!stat.isDirectory()) throw new Error("Workspace is not a directory");
  return localDigest({ canonicalPath, device: String(stat.dev), inode: String(stat.ino) });
}
export function physicalLockIdentity(path: string) {
  const stat = statSync(realpathSync(path), { bigint: true });
  return localDigest({ device: String(stat.dev), inode: String(stat.ino) });
}
export function privateRoot(root: string) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || realpathSync(root) !== root) throw new Error("Workspace managed root must be private and canonical");
}

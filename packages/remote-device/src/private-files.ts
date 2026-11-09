import { constants, closeSync, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function privateFile(path: string, create = false) {
  const fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW | (create ? constants.O_CREAT : 0), 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || (process.getuid && stat.uid !== process.getuid())) throw new Error("Unsafe private file permissions or ownership");
  } finally { closeSync(fd); }
}
export function readPrivate(path: string): string {
  privateFile(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (fstatSync(fd).size > 1_048_576) throw new Error("Private file exceeds limit"); return readFileSync(fd, "utf8"); }
  finally { closeSync(fd); }
}
/** Private parent is canonical and mode 0700. Rename + parent fsync survives lost pairing replies. */
export function writePrivate(path: string, value: unknown, replace = true) {
  if (lstatSync(path, { throwIfNoEntry: false })) { if (!replace) throw new Error("Private file already exists"); privateFile(path); }
  const temporary = `${path}.${randomUUID()}.next`, fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); }
  finally { closeSync(fd); }
  try { renameSync(temporary, path); syncDirectory(dirname(path)); }
  catch (error) { unlinkSync(temporary); throw error; }
}

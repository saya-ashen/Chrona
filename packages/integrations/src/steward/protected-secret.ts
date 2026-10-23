import { readFile, stat } from "node:fs/promises";

/** Reads a secret only if it is a private regular file of this user (mode 600). */
export async function readProtectedSecret(path: string): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || (typeof process.getuid === "function" && info.uid !== process.getuid())) throw new Error("Secret file must be a private file owned by this user");
  const secret = (await readFile(path, "utf8")).trim();
  if (!secret || /\s/.test(secret)) throw new Error("Secret file is empty or malformed");
  return secret;
}

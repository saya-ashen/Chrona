import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

/** Engine-only storage. Never pass these values to projections, activity or audit. */
export function createSecrets(dataDir: string) {
  const root = resolve(dataDir), dir = join(root, "secrets");
  async function path(id: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error("Invalid connector id");
    await mkdir(root, { recursive: true });
    if (await realpath(root) !== root) throw new Error("Unsafe data directory");
    await mkdir(dir, { mode: 0o700, recursive: true });
    if (!(await lstat(dir)).isDirectory() || await realpath(dir) !== dir) throw new Error("Unsafe secrets directory");
    await chmod(dir, 0o700);
    return join(dir, `${id}.json`);
  }
  return {
    async write(id: string, secret: Record<string, string>) {
      const target = await path(id), temporary = join(dir, `.${randomUUID()}.tmp`);
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await file.chmod(0o600);
        await file.writeFile(JSON.stringify(secret));
        await file.sync();
      } finally { await file.close(); }
      try { await rename(temporary, target); }
      finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    },
    async read(id: string): Promise<Record<string, string> | null> {
      let file;
      try { file = await open(await path(id), constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
      try {
        const info = await file.stat();
        if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.size > 1024 * 1024) throw new Error("Unsafe secret file");
        const value: unknown = JSON.parse(await file.readFile("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every(v => typeof v === "string")) throw new Error("Invalid secret file");
        return value as Record<string, string>;
      } finally { await file.close(); }
    },
    async remove(id: string) {
      try { await unlink(await path(id)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    },
  };
}

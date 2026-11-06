import { spawn } from "node:child_process";
import { constants, closeSync, fstatSync, openSync } from "node:fs";
import { join } from "node:path";
import { privateDirectory } from "./executor-config";

/** Linux flock follows the inherited open file description; this process retains fd until operation finishes. */
export async function lockedExecutorCommand(operation: string, dataDir: string, execute: () => Promise<void>): Promise<number> {
  privateDirectory(dataDir, operation === "configure");
  const fd = openSync(join(dataDir, "foreground.lock"), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid?.()) throw new Error("Unsafe executor lock file");
    const child = spawn("flock", ["--nonblock", "--conflict-exit-code", "75", "3"], { stdio: ["ignore", "ignore", "ignore", fd], env: { PATH: process.env.PATH }, shell: false });
    const code = await new Promise<number>((resolveExit, reject) => {
      child.once("error", () => reject(new Error("Executor requires native util-linux flock")));
      child.once("exit", code => resolveExit(code ?? 1));
    });
    if (code === 75) { console.error("Executor directory is busy; no local state was changed."); return code; }
    if (code !== 0) throw new Error("Executor OS lock failed");
    delete process.env.API_KEY; delete process.env.DATABASE_URL;
    await execute(); return 0;
  } finally { closeSync(fd); }
}

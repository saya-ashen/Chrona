import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Set only by the trusted process launcher, never by an operation request. */
export function currentHostGeneration() {
  const generation = process.env.CHRONA_HOST_GENERATION;
  return generation && /^[a-f0-9]{64}$/.test(generation) ? generation : undefined;
}

/** A trusted receipt proves descendant termination, never business success. */
export async function hostStopped(data: string, generation: string): Promise<boolean> {
  if (process.platform !== "linux" || generation === currentHostGeneration() || !/^[a-f0-9]{64}$/.test(generation)) return false;
  const path = join(data, ".host-stops", generation + ".json");
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      // Keep the receipt protocol validation aligned with the trusted process launcher.
      const stat = await file.stat();
      if (![stat.isFile(), stat.size <= 512, stat.nlink === 1, (stat.mode & 0o077) === 0, stat.uid === process.getuid?.()].every(Boolean)) return false;
      const value = JSON.parse(await file.readFile("utf8"));
      if (![value.version === 1, value.generation === generation, value.state === "stopped", value.scope === "descendants", value.treeClean === true].every(Boolean)) return false;
      // The reader may race the guardian's final fsync; establish durability before accepting it.
      await file.sync();
      const directory = await open(dirname(path), "r");
      try { await directory.sync(); } finally { await directory.close(); }
      return true;
    } finally { await file.close(); }
  } catch { return false; }
}

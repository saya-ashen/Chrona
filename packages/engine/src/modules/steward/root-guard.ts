import { lstat, mkdir, readdir, realpath, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StewardPorts } from "./ports";
import { audit } from "./audit";

/** Snapshot before launch; quarantine only newly created non-directory entries after exit.
 * Applies defensively to all root providers (including sandboxed ones). Never follows links.
 */
export async function guardWorkspaceRoot(ports: StewardPorts, workspaceId: string, runId: string, cwd: string) {
  const root = resolve(cwd);
  if (await realpath(root) !== root) throw new Error("Unsafe workspace root");
  const before = new Set(await readdir(root));
  async function safeDirectory(path: string) {
    await mkdir(path, { recursive: true });
    if (!(await lstat(path)).isDirectory() || await realpath(path) !== path) throw new Error("Unsafe quarantine directory");
  }
  return async () => {
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (before.has(entry.name) || entry.isDirectory()) continue;
        const metadata = join(root, ".chrona");
        await safeDirectory(metadata);
        await safeDirectory(join(metadata, "stray"));
        const destination = join(metadata, "stray", runId);
        // Run IDs are Chrona-generated, never provider input.
        await safeDirectory(destination);
        const target = join(destination, entry.name);
        try { await lstat(target); throw new Error("Quarantine destination already exists"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await rename(join(root, entry.name), target);
        await audit(ports.db, { workspaceId, actor: "chrona", kind: "workspace_stray_quarantined", subjectId: runId,
          details: { path: entry.name, destination: `.chrona/stray/${runId}/${entry.name}` } });
      }
    } catch (error) {
      await audit(ports.db, { workspaceId, actor: "chrona", kind: "workspace_stray_quarantine_failed", subjectId: runId, details: {} });
      throw error;
    }
  };
}

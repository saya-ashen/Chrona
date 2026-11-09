import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProcessHelper } from "../scripts/build-helper";
import { processCapability, requireDescendantStop, spawnSupervised } from "./index";

let buildDir: string, helperPath: string;
beforeAll(() => {
  if (process.platform !== "darwin") return;
  buildDir = mkdtempSync(join(tmpdir(), "chrona-darwin-build-"));
  helperPath = buildProcessHelper(join(buildDir, "guardian"));
});
afterAll(() => { if (buildDir) rmSync(buildDir, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "darwin")("macOS native refusal of descendant proof", () => {
  test("a detached child escapes the group; group cleanup cannot release descendant capacity", async () => {
    const node = Bun.which("node");
    if (!node) throw new Error("Real Node required for macOS detached-child acceptance");
    expect(processCapability({ helperPath })).toMatchObject({ scope: "process-group", treeClean: false, validation: "pending" });
    const root = mkdtempSync(join(tmpdir(), "chrona-darwin-escape-"));
    const task = spawnSupervised(node, [join(import.meta.dir, "node.fixture.mjs"), "task", root], { helperPath });
    task.process.stdin.end(); task.process.stdout.resume(); task.process.stderr.resume();
    let leaf: number | undefined;
    try {
      await task.ready;
      const deadline = Date.now() + 5000;
      while (!existsSync(join(root, "leaf"))) {
        if (Date.now() >= deadline) throw new Error("detached child did not start");
        await Bun.sleep(10);
      }
      leaf = Number(readFileSync(join(root, "leaf"), "utf8"));
      task.stop();
      const result = await task.exited;
      expect(result.stop.treeClean).toBe(false);
      expect(() => requireDescendantStop(result)).toThrow("stop unknown");
      // This is deliberate evidence that PGID success is insufficient.
      expect(() => process.kill(leaf!, 0)).not.toThrow();
    } finally {
      task.stop(); await task.exited;
      if (leaf) { try { process.kill(leaf, "SIGKILL"); } catch { /* exited */ } }
      rmSync(root, { recursive: true, force: true });
    }
  });
});

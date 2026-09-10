import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Readable, Writable } from "node:stream";
import { PI_BRIDGE_SOURCE } from "./bridge-source";

describe.skipIf(process.platform === "win32")("Pi bridge IPC lifecycle", () => {
  it("allows Node to exit while the parent keeps the bridge input open", async () => {
    const root = await mkdtemp(join(tmpdir(), "chrona-pi-bridge-exit-"));
    await writeFile(join(root, "bridge.mjs"), PI_BRIDGE_SOURCE);
    await writeFile(join(root, "main.mjs"), `import bridge from './bridge.mjs';
      await bridge({registerTool(){},on(){}});
      // Allow a second bridge read to become pending, then exit without parent EOF.
      setTimeout(() => process.exit(0), 100);`);
    const child = spawn("node", [join(root, "main.mjs")], { stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"] });
    for (const fd of [1, 2, 4]) (child.stdio[fd] as Readable).resume();
    const exited = new Promise<number | null>((resolve) => { child.once("exit", resolve); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      (child.stdio[3] as Writable).write(JSON.stringify({ type: "init", tools: [], instructions: "fixture" }) + "\n");
      const code = await Promise.race([exited, new Promise<string>((resolve) => { timer = setTimeout(() => resolve("exit blocked by bridge read"), 2000); })]);
      expect(code).toBe(0);
    } finally {
      if (timer) clearTimeout(timer);
      child.kill("SIGKILL");
      for (const stream of child.stdio) stream?.destroy();
      await exited;
      await rm(root, { recursive: true, force: true });
    }
  });
});

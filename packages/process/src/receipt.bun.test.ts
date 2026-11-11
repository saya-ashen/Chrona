import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { buildProcessHelper } from "../scripts/build-helper";
import { readStopReceipt, spawnSupervised } from "./index";

test.skipIf(process.platform !== "linux")("owner loss leaves generation-bound descendant stop proof without replay", async () => {
  const root = await mkdtemp("/tmp/chrona-stop-test-");
  const generation = randomBytes(32).toString("hex"), path = join(root, "stop.json");
  const helperPath = buildProcessHelper(join(root, "guardian"));
  let owner: ReturnType<typeof Bun.spawn> | undefined;
  try {
    await writeFile(join(root, "owner.ts"), `import {spawnSupervised} from ${JSON.stringify(join(import.meta.dir, "index.ts"))};
const task=spawnSupervised(process.execPath,${JSON.stringify([join(import.meta.dir, "subprocess.fixture.ts"), "task", root, "escape"])},{helperPath:${JSON.stringify(helperPath)},stopReceipt:${JSON.stringify({ path, generation })}});
await task.ready; while(!await Bun.file(${JSON.stringify(join(root, "leaf"))}).exists()) await Bun.sleep(5); await Bun.write(${JSON.stringify(join(root, "ready"))},"yes"); setInterval(()=>{},1000);`);
    owner = Bun.spawn([process.execPath, join(root, "owner.ts")], { stdout: "ignore", stderr: "pipe" });
    for (let i = 0; i < 150; i++) { try { await readFile(join(root, "ready")); break; } catch { await Bun.sleep(20); } }
    expect(await readFile(join(root, "ready"), "utf8")).toBe("yes");
    await expect(readStopReceipt({ path, generation })).rejects.toThrow();
    owner.kill("SIGKILL"); await owner.exited;
    let evidence;
    for (let i = 0; i < 150; i++) { try { evidence = await readStopReceipt({ path, generation }); break; } catch { await Bun.sleep(20); } }
    expect(evidence).toMatchObject({ state: "stopped", treeClean: true });
    for (const name of ["task", "middle", "leaf"]) { const pid = Number(await readFile(join(root, name), "utf8")); expect(() => process.kill(pid, 0)).toThrow(); }
    await expect(readStopReceipt({ path, generation: "0".repeat(64) })).rejects.toThrow();
    await expect(readStopReceipt({ path: join(root, "missing"), generation })).rejects.toThrow();
    const replay = spawnSupervised(process.execPath, ["-e", "process.exit(0)"], { helperPath, stopReceipt: { path, generation } });
    expect((await replay.exited).stop.state).toBe("unknown");
  } finally { owner?.kill(); await rm(root, { recursive: true, force: true }); }
}, 15000);

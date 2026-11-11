import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSupervised } from "@chrona/process";
import { createAgentOperations } from "../../packages/engine/src/modules/steward/builtin/agent/operations";

test.skipIf(process.platform !== "linux")("original host proof recovers uncertain operation without another launch", async () => {
  const root = await mkdtemp("/tmp/chrona-agent-host-test-");
  const generation = randomBytes(32).toString("hex"), old = process.env.CHRONA_HOST_GENERATION;
  let starts = 0;
  const provider = { name: "fixture", async health() { return { available: true, sandboxed: false, error: null }; }, start() { starts++; return { done: new Promise<never>(() => {}), async abort() {}, async inject() {} }; } };
  const request = { operationId: "original", runId: "original", token: "fixture", lane: "foreground", cwd: root, sessionDir: root, sessionId: null, prompt: "fixture", systemPrompt: "", resources: "minimal", deadline: null };
  try {
    process.env.CHRONA_HOST_GENERATION = generation;
    await createAgentOperations(provider, root, value => value as never).start(request);
    process.env.CHRONA_HOST_GENERATION = randomBytes(32).toString("hex");
    const reopened = createAgentOperations(provider, root, value => value as never);
    expect(await reopened.control("status", { operationId: "original" })).toMatchObject({ outcome: null, failure: true });
    await expect(reopened.control("release", { operationId: "original" })).rejects.toMatchObject({ code: "conflict" });
    await mkdir(join(root, ".host-stops"), { mode: 0o700 });
    const task = spawnSupervised(process.execPath, ["-e", "process.exit(0)"], { stopReceipt: { path: join(root, ".host-stops", generation + ".json"), generation } });
    expect((await task.exited).stop.treeClean).toBe(true);
    expect(await reopened.control("status", { operationId: "original" })).toMatchObject({ failure: false, outcome: { outcome: "failed" } });
    await reopened.start(request);
    expect(starts).toBe(1);
    expect(await reopened.control("release", { operationId: "original" })).toEqual({ released: true });
    expect(await createAgentOperations(provider, root, value => value as never).control("status", { operationId: "original" })).toMatchObject({ outcome: { outcome: "failed" } });
  } finally { if (old === undefined) delete process.env.CHRONA_HOST_GENERATION; else process.env.CHRONA_HOST_GENERATION = old; await rm(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== "linux")("killed Agent host and its actual Provider tree reconcile from the original generation", async () => {
  const root = await mkdtemp("/tmp/chrona-real-host-test-"), generation = randomBytes(32).toString("hex");
  await mkdir(join(root, ".host-stops"), { mode: 0o700 });
  const request = { operationId: "killed", runId: "killed", token: "fixture", lane: "foreground", cwd: root, sessionDir: root, sessionId: null, prompt: "fixture", systemPrompt: "", resources: "minimal", deadline: null };
  const source = `import {createAgentOperations} from ${JSON.stringify(join(import.meta.dir, "../../packages/engine/src/modules/steward/builtin/agent/operations.ts"))};
import {spawnSupervised} from ${JSON.stringify(join(import.meta.dir, "../../packages/process/src/index.ts"))};
const provider={name:"fixture",start(){const task=spawnSupervised(process.execPath,["-e","setInterval(()=>{},1000)"]); return {done:task.exited.then(()=>new Promise(()=>{})),async abort(){task.stop()},async inject(){}}}};
await createAgentOperations(provider,${JSON.stringify(root)},v=>v).start(${JSON.stringify(request)});
await Bun.write(${JSON.stringify(join(root, "ready"))},"yes");setInterval(()=>{},1000);`;
  await writeFile(join(root, "host.ts"), source);
  const task = spawnSupervised(process.execPath, [join(root, "host.ts")], { env: { ...process.env, CHRONA_HOST_GENERATION: generation }, stopReceipt: { path: join(root, ".host-stops", generation + ".json"), generation } });
  task.process.stdout.resume(); task.process.stderr.resume();
  try {
    const ready = await task.ready;
    for (let i = 0; i < 150; i++) { try { await readFile(join(root, "ready")); break; } catch { await Bun.sleep(20); } }
    expect(await readFile(join(root, "ready"), "utf8")).toBe("yes");
    process.kill(ready.pid, "SIGKILL");
    expect((await task.exited).stop.treeClean).toBe(true);
    const reopened = createAgentOperations(undefined, root, value => value as never);
    expect(await reopened.control("status", { operationId: "killed" })).toMatchObject({ outcome: { outcome: "failed" }, failure: false });
    expect(await reopened.control("release", { operationId: "killed" })).toEqual({ released: true });
  } finally { task.stop(); await task.exited; await rm(root, { recursive: true, force: true }); }
}, 15000);

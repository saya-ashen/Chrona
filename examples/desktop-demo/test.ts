import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startModule } from "chrona/testing";

const root = await mkdtemp(join(tmpdir(), "chrona-desktop-demo-"));
const original = { ...process.env };
const source = process.env.CHRONA_MODULE ?? import.meta.dirname;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const now = new Date().toISOString();
type Output = { module: string; window: string; pid: number | null; evidence: string; mappedAt: string | null; reused?: boolean; focusRequested?: boolean; failure: string | null };
let runtime: Awaited<ReturnType<typeof startModule>> | undefined;
async function tool(id: string) {
  const reply = await runtime!.send({ trigger: { kind: "tool", id, args: {}, firedAt: now }, now, params: {} });
  assert.equal(reply.error, undefined, reply.error);
  assert.ok(reply.result);
  return reply.result.result as Output;
}
async function waitClosed() {
  for (let i = 0; i < 50; i++) {
    const value = await tool("status");
    if (value.window === "closed") return value;
    await Bun.sleep(20);
  }
  throw new Error("Window did not close");
}
try {
  await mkdir(join(root, "dist")); await mkdir(join(root, "data")); await mkdir(join(root, "content"));
  await cp(join(source, "module.json"), join(root, "module.json"));
  await cp(join(source, "main.ts"), join(root, "main.ts"));
  await cp(join(source, "dist/entry.js"), join(root, "dist/entry.js"));
  // Offline fixture explicitly simulates GTK events. It is never true-window evidence.
  await writeFile(join(root, "desktop-window.py"), `import json, os, signal, subprocess, sys, time
config = json.load(open(sys.argv[1]))
assert os.environ.get("XAUTHORITY") == "/fixture/auth"
assert "CHRONA_IPC_TOKEN" not in os.environ
if config.get("fail"):
    print("fixture display failure", file=sys.stderr, flush=True)
    sys.exit(1)
if config.get("descendant"):
    child = subprocess.Popen([sys.executable, "-c", "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(3600)"], start_new_session=True)
    open(config["descendant"], "w").write(str(child.pid))
signal.signal(signal.SIGUSR1, lambda *_: sys.exit(0))
if not config.get("neverMap"):
    print('{"event":"mapped"}', flush=True)
for line in sys.stdin:
    if line.strip() == "close": break
    if line.strip() == "focus": print('{"event":"presented"}', flush=True)
`);
  const config = (value: object) => writeFile(join(root, "dist/backend.json"), JSON.stringify(value));
  await config({});
  process.env.CHRONA_MODULE = root; process.env.CHRONA_DATA = join(root, "data"); process.env.CHRONA_CONTENT = join(root, "content");
  delete process.env.DISPLAY; delete process.env.WAYLAND_DISPLAY;
  const entry = JSON.parse(await readFile(join(root, "module.json"), "utf8")).entry;
  runtime = await startModule(entry);
  assert.equal((await tool("status")).window, "closed");
  const headless = await runtime.send({ trigger: { kind: "tool", id: "open", args: {}, firedAt: now }, now, params: {} });
  assert.match(headless.error!, /No local desktop session/);
  assert.equal((await tool("status")).module, "ready");
  await runtime.stop(); runtime = undefined;
  process.env.DISPLAY = ":fixture"; process.env.XAUTHORITY = "/fixture/auth";
  runtime = await startModule(entry);
  const first = await tool("open");
  assert.equal(first.window, "mapped"); assert.equal(first.evidence, "gtk-map"); assert.ok(first.mappedAt); assert.ok(alive(first.pid!));
  const again = await tool("open");
  assert.equal(again.pid, first.pid); assert.equal(again.reused, true); assert.equal(again.focusRequested, true);
  process.kill(first.pid!, "SIGUSR1"); // Fixture simulates user closing the native window.
  assert.equal((await waitClosed()).module, "ready");
  assert.equal(alive(first.pid!), false);
  const reopened = await tool("open"); assert.notEqual(reopened.pid, first.pid);
  const closed = await tool("close"); assert.equal(closed.window, "closed"); assert.equal(alive(reopened.pid!), false);
  assert.equal((await tool("close")).window, "closed");
  await config({ fail: true });
  const failed = await runtime.send({ trigger: { kind: "tool", id: "open", args: {}, firedAt: now }, now, params: {} });
  assert.match(failed.error!, /fixture display failure/);
  assert.equal((await tool("status")).module, "ready");
  await config({ neverMap: true });
  const unmapped = await runtime.send({ trigger: { kind: "tool", id: "open", args: {}, firedAt: now }, now, params: {} });
  assert.match(unmapped.error!, /mapped timeout/);
  assert.equal((await tool("status")).pid, null);
  const descendantFile = join(root, "descendant.pid");
  await config({ descendant: descendantFile });
  const running = await tool("open");
  const descendant = Number(await readFile(descendantFile, "utf8")); assert.ok(alive(descendant));
  // stop() resolves only through requireDescendantStop: stopped + descendants + treeClean.
  await runtime.stop(); runtime = undefined;
  assert.equal(alive(running.pid!), false); assert.equal(alive(descendant), false);
  console.log("Desktop demo offline lifecycle passed (fixture events; guardian descendant-empty proof)");
} finally {
  await runtime?.stop();
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
  await rm(root, { recursive: true, force: true });
}

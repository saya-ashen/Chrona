import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProcessHelper } from "../../../process/scripts/build-helper";
import { createScriptSandbox } from "./script-sandbox";

const localTest = process.platform === "linux" ? test : test.skip;
const sessionKeys = ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"];
const blockedKeys = ["API_KEY", "CHRONA_HOST_SECRET", "SSH_AUTH_SOCK", "XDG_SESSION_TYPE", "GDK_BACKEND", "CHRONA_SOCKET", "CHRONA_HTTP_SOCKET"];
const probeKeys = [...sessionKeys, ...blockedKeys, "CHRONA_IPC_ENDPOINT", "CHRONA_IPC_TOKEN", "CHRONA_DESKTOP_TEST"];
let helperDir: string, helper: string;
beforeAll(async () => {
  if (process.platform !== "linux") return;
  helperDir = await mkdtemp(join(tmpdir(), "chrona-desktop-guardian-"));
  helper = buildProcessHelper(join(helperDir, "guardian"));
});
afterAll(async () => { if (helperDir) await rm(helperDir, { recursive: true, force: true }); });

// Keep mutations synchronous around spawn, so each child's environment is fixed
// before restoring the test process's original session and synthetic secrets.
function withHost<T>(session: Record<string, string>, spawn: () => T): T {
  const keys = [...sessionKeys, ...blockedKeys];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of sessionKeys) delete process.env[key];
    Object.assign(process.env, session, Object.fromEntries(blockedKeys.map(key => [key, "synthetic-host-private-value"])));
    return spawn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
}

const cases: { name: string; session: Record<string, string> }[] = [
  { name: "X11", session: { DISPLAY: ":71", XAUTHORITY: "/synthetic/session/Xauthority", XDG_RUNTIME_DIR: "/synthetic/runtime", DBUS_SESSION_BUS_ADDRESS: "unix:path=/synthetic/runtime/bus" } },
  { name: "Wayland with XWayland", session: { DISPLAY: ":72", WAYLAND_DISPLAY: "wayland-7", XAUTHORITY: "/synthetic/session/wayland-auth", XDG_RUNTIME_DIR: "/synthetic/runtime", DBUS_SESSION_BUS_ADDRESS: "unix:path=/synthetic/runtime/bus" } },
  { name: "headless", session: {} },
  { name: "empty session", session: Object.fromEntries(sessionKeys.map(key => [key, ""])) },
];

for (const { name, session } of cases) for (const explicit of [false, true]) localTest(`${name}: ${explicit ? "explicit interpreter" : "script"} inherits only host session and stops descendants`, async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-desktop-env-"));
  const codeDir = join(root, "code"), dataDir = join(root, "data");
  const sandbox = createScriptSandbox({ processHelper: helper });
  let handle: ReturnType<typeof sandbox.startModule> | undefined;
  try {
    await mkdir(codeDir); await mkdir(dataDir);
    // No display, D-Bus or IPC connection is made: probe the actual spawned
    // environment, and keep an escaped descendant alive until supervised stop.
    await writeFile(join(codeDir, "probe.ts"), `import { spawn } from "node:child_process";
import { writeFileSync, renameSync } from "node:fs";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
child.unref();
const env = Object.fromEntries(${JSON.stringify(probeKeys)}.map(key => [key, process.env[key] ?? null]));
writeFileSync(process.env.CHRONA_DATA + "/pending.json", JSON.stringify({ env, child: child.pid }));
renameSync(process.env.CHRONA_DATA + "/pending.json", process.env.CHRONA_DATA + "/probe.json");
setInterval(() => {}, 1000);
`);
    const ipcEndpoint = "tcp://127.0.0.1:12345", ipcToken = "a".repeat(64);
    handle = withHost(session, () => sandbox.startModule({ codeDir, dataDir,
      entry: explicit ? { path: "probe.ts", runtime: "bun", args: ["--no-install"] } : "probe.ts",
      ipcEndpoint, ipcToken,
      env: { ...Object.fromEntries([...sessionKeys, ...blockedKeys.filter(key => key !== "CHRONA_HOST_SECRET")].map(key => [key, "injected-module-value"])),
        CHRONA_IPC_ENDPOINT: "tcp://127.0.0.1:1", CHRONA_IPC_TOKEN: "untrusted", CHRONA_DESKTOP_TEST: "allowed-extra" },
    }));
    await handle.ready;
    const file = join(dataDir, "probe.json"), deadline = Date.now() + 3000;
    while (!existsSync(file)) {
      if (Date.now() > deadline) throw new Error("environment probe did not start: " + handle.stderr());
      await Bun.sleep(5);
    }
    const output = JSON.parse(await readFile(file, "utf8")) as { env: Record<string, string | null>; child: number };
    expect(output.env).toEqual({ ...Object.fromEntries(sessionKeys.map(key => [key, session[key] || null])),
      ...Object.fromEntries(blockedKeys.map(key => [key, null])),
      CHRONA_IPC_ENDPOINT: ipcEndpoint, CHRONA_IPC_TOKEN: ipcToken, CHRONA_DESKTOP_TEST: "allowed-extra" });
    process.kill(output.child, 0);
    handle.kill(); await handle.exited;
    expect(await handle.stopEvidence).toMatchObject({ state: "stopped", scope: "descendants", treeClean: true });
    expect(() => process.kill(output.child, 0)).toThrow();
  } finally {
    handle?.kill(); await handle?.exited;
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);

localTest("headless one-shot author scripts still complete without session or IPC variables", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-desktop-headless-"));
  const codeDir = join(root, "code"), dataDir = join(root, "data");
  try {
    await mkdir(codeDir); await mkdir(dataDir);
    await writeFile(join(codeDir, "test.ts"), `const input = JSON.parse(await Bun.stdin.text());
console.log(JSON.stringify({ value: input.value, session: Object.fromEntries(${JSON.stringify([...sessionKeys, "CHRONA_IPC_ENDPOINT", "CHRONA_IPC_TOKEN"])}.map(key => [key, process.env[key] ?? null])) }));`);
    const result = await withHost({}, () => createScriptSandbox({ processHelper: helper }).runModule({ codeDir, dataDir, entry: "test.ts", input: { value: 42 } }));
    expect(result).toMatchObject({ status: "succeeded", stopEvidence: { state: "stopped", scope: "descendants", treeClean: true } });
    expect(JSON.parse(result.output)).toEqual({ value: 42, session: Object.fromEntries([...sessionKeys, "CHRONA_IPC_ENDPOINT", "CHRONA_IPC_TOKEN"].map(key => [key, null])) });
  } finally { await rm(root, { recursive: true, force: true }); }
});

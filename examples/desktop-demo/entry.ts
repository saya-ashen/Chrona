import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
// The ordinary Bun script launcher supplies the trusted SDK directory.
const { on, onDisconnect, chrona } = await import(join(process.env.CHRONA_SDK!, "sdk.ts")) as typeof import("chrona");

type WindowState = "closed" | "opening" | "mapped" | "closing" | "failed";
type WindowChild = {
  process: ChildProcessWithoutNullStreams;
  exited: Promise<void>;
  event: ((event: string) => void) | null;
  onExit: (() => void) | null;
};
let child: WindowChild | null = null;
let state: WindowState = "closed", failure: string | null = null;
let mappedAt: string | null = null;
let lastExit: { code: number | null; signal: string | null } | null = null;
const sessionVariables = ["PATH", "HOME", "LANG", "LC_ALL", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XDG_DATA_DIRS", "XDG_CONFIG_HOME", "GDK_BACKEND", "GSK_RENDERER"];
function status() {
  return { module: "ready", window: state, pid: child?.process.pid ?? null, mappedAt, failure, lastExit,
    evidence: mappedAt ? "gtk-map" : "none", focus: "compositor-controlled" };
}
function waitEvent(current: WindowChild, expected: string, action?: () => void) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); current.event = null; current.onExit = null; if (error) reject(error); else resolve(); };
    const timer = setTimeout(() => finish(new Error(`Window ${expected} timeout`)), 2500);
    current.event = event => { if (event === expected) finish(); };
    current.onExit = () => finish(new Error(failure ?? "Window exited before readiness"));
    action?.();
  });
}
function launch(): WindowChild {
  const env = Object.fromEntries(sessionVariables.flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!]]));
  const proc = spawn("python3", ["-u", join(chrona.paths.module, "desktop-window.py"), join(chrona.paths.module, "dist/backend.json")], { env, stdio: "pipe" });
  let resolveExit!: () => void;
  const current: WindowChild = { process: proc, exited: new Promise(resolve => { resolveExit = resolve; }), event: null, onExit: null };
  child = current; state = "opening"; failure = null; mappedAt = null;
  let output = "", stderr = "";
  proc.stdout.setEncoding("utf8"); proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
  proc.stdout.on("data", (chunk: string) => {
    output += chunk;
    if (output.length > 8192) { failure = "Invalid window helper output"; proc.kill(); return; }
    while (output.includes("\n")) {
      const index = output.indexOf("\n"), line = output.slice(0, index); output = output.slice(index + 1);
      try {
        const value: unknown = JSON.parse(line);
        if (typeof value !== "object" || value === null || !("event" in value)) throw new Error("Invalid helper event");
        const event = value.event;
        if (event === "mapped") { state = "mapped"; mappedAt = new Date().toISOString(); }
        if (typeof event === "string") current.event?.(event);
      } catch { failure = "Invalid window helper output"; proc.kill(); }
    }
  });
  proc.stdin.on("error", () => {}); // Exit/close is the authoritative termination observation.
  proc.once("error", error => { failure = error.message.slice(0, 2000); });
  proc.once("close", (code, signal) => {
    lastExit = { code, signal };
    if (code !== 0 && state !== "closing") failure ??= stderr.trim() || `Window exited (${code ?? signal})`;
    state = failure ? "failed" : "closed";
    child = null; mappedAt = null; current.onExit?.(); resolveExit();
  });
  return current;
}
async function waitExit(current: WindowChild, timeout: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([current.exited.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeout); })]); }
  finally { clearTimeout(timer); }
}
async function closeWindow() {
  const current = child;
  if (!current) return;
  state = "closing";
  current.process.stdin.write("close\n");
  if (await waitExit(current, 600)) return;
  current.process.kill("SIGTERM");
  if (await waitExit(current, 600)) return;
  current.process.kill("SIGKILL");
  if (!await waitExit(current, 600)) throw new Error("Window process stop is unknown");
}
async function openWindow() {
  if (child) {
    const current = child;
    await waitEvent(current, "presented", () => current.process.stdin.write("focus\n"));
    return { ...status(), reused: true, focusRequested: true };
  }
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error("No local desktop session: DISPLAY or WAYLAND_DISPLAY is required");
  const current = launch();
  try { await waitEvent(current, "mapped"); }
  catch (error) { failure = error instanceof Error ? error.message : String(error); await closeWindow(); throw error; }
  return { ...status(), reused: false, focusRequested: false };
}
on("tool", async event => {
  if (Object.keys(event.args).length) throw new Error("Desktop demo tools accept no arguments");
  if (event.id === "open") return { result: await openWindow() };
  if (event.id === "close") { await closeWindow(); return { result: status() }; }
  if (event.id === "status") return { result: status() };
  throw new Error("Unknown desktop demo tool");
});
onDisconnect(() => { child?.process.kill("SIGTERM"); });

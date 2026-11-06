import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, realpathSync, statSync, statfsSync, readlinkSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executorProcessIdentitySchema, type ExecutorAssignment } from "@chrona/contracts/steward";
import type { PiProcess, PiProcessInput } from "../steward/pi-process";
import { ExecutorJournal, assignmentUnit, localDigest, type LocalJournal, type ManagerObservation } from "./journal";

const PROPERTIES = "Id,LoadState,ActiveState,SubState,InvocationID,ControlGroup,ExitType,RemainAfterExit,KillMode,MainPID,Result,ExecMainCode,ExecMainStatus";
const bootId = () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
type Properties = Record<string, string>;
function systemctl(args: string[]) {
  const result = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8", timeout: 4000, maxBuffer: 16_384, env: process.env });
  if (result.error || result.status !== 0) throw new Error("Owned systemd operation unavailable");
  return result.stdout;
}
export function inspectExecutorUnit(unit: string): Properties {
  return Object.fromEntries(systemctl(["show", unit, `--property=${PROPERTIES}`]).trim().split("\n").map(line => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
}
function propertiesMatch(properties: Properties, value: LocalJournal) {
  const identity = value.journal.identity;
  return identity && bootId() === identity.bootId && properties.Id === identity.unit && properties.InvocationID === identity.invocationId && properties.ExitType === "cgroup" && properties.RemainAfterExit === "yes" && properties.KillMode === "control-group";
}
function cgroupRootIdentity() {
  const root = "/sys/fs/cgroup";
  if (realpathSync(root) !== root || statfsSync(root).type !== 0x63677270) throw new Error("Unified cgroup mount unavailable");
  const mount = readFileSync("/proc/self/mountinfo", "utf8").split("\n").find(line => line.split(" ")[4] === root && line.includes(" - cgroup2 "));
  if (!mount) throw new Error("Unified cgroup mount unavailable");
  const own = readFileSync("/proc/self/cgroup", "utf8").split("\n").find(line => line.startsWith("0::"))?.slice(3);
  if (!own || !existsSync(join(root, own, "cgroup.events"))) throw new Error("Current cgroup namespace is not visible");
  const stat = statSync(root, { bigint: true });
  return localDigest({ mount, namespace: readlinkSync("/proc/self/ns/cgroup"), device: String(stat.dev), inode: String(stat.ino) });
}
function terminalCgroupState(controlGroup: string) {
  if (!controlGroup.startsWith("/") || controlGroup === "/" || controlGroup.split("/").some(part => part === "." || part === "..")) throw new Error("Original cgroup path invalid");
  try {
    const events = readFileSync(join("/sys/fs/cgroup", controlGroup, "cgroup.events"), "utf8");
    return /^populated 0$/m.test(events) ? "empty" : "populated";
  } catch (error) {
    // Only a still-loaded original failed invocation supplies the other half of this proof.
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !existsSync(join("/sys/fs/cgroup", controlGroup))) return "removed";
    throw new Error("Original cgroup state unavailable", { cause: error });
  }
}
// eslint-disable-next-line complexity -- A failed invocation needs both stable manager identity and original-kernel-group evidence.
export function observeExecutorStop(value: LocalJournal, properties: Properties): ManagerObservation | null {
  if (!propertiesMatch(properties, value)) throw new Error("Owned invocation identity or supervision changed");
  const failed = properties.LoadState === "loaded" && properties.ActiveState === "failed" && properties.SubState === "failed" && properties.MainPID === "0" && properties.ControlGroup === "";
  if (failed) {
    if (!value.supervisionRoot || value.supervisionRoot !== cgroupRootIdentity()) throw new Error("Original cgroup mount identity changed");
    const state = terminalCgroupState(value.journal.identity!.controlGroup), after = inspectExecutorUnit(value.unit);
    if (localDigest(after) !== localDigest(properties) || !propertiesMatch(after, value)) throw new Error("Manager observation changed during kernel check");
    properties = { ...properties, KernelCgroupState: state, KernelCgroupRoot: value.supervisionRoot };
  }
  if (properties.MainPID === "0" && (properties.ActiveState === "active" && properties.SubState === "exited" || failed && ["empty", "removed"].includes(properties.KernelCgroupState!))) {
    const identity = value.journal.identity!, observedAt = new Date().toISOString();
    const binding = { assignmentId: value.journal.assignment.assignmentId, launchDigest: value.journal.launchDigest, identity, observedAt, properties };
    return { ...binding, digest: localDigest(binding) };
  }
  if (properties.ActiveState !== "active" || properties.SubState !== "running" || properties.ControlGroup !== value.journal.identity!.controlGroup) throw new Error("Owned invocation observation lost");
  return null;
}

/** Recovery never launches. Intent without durable identity remains unknown even when a unit exists. */
export function recoverExecutorProcess(store: ExecutorJournal, unit: string) {
  const value = store.read(unit);
  if (!value) throw new Error("Journal missing");
  if (value.launchState === "prelaunch" && value.journal.tombstoneDigest) return { state: "stopped" as const, value };
  if (value.observation) return { state: "stopped" as const, value };
  try {
    if (!value.journal.identity) return { state: "unknown" as const, value, properties: inspectExecutorUnit(unit) };
    const observation = observeExecutorStop(value, inspectExecutorUnit(unit));
    if (observation) return { state: "stopped" as const, value: store.write({ ...value, observation }) };
    return { state: "owned" as const, value };
  } catch { return { state: "unknown" as const, value }; }
}

export type ExecutorProcessEntry = { file: string; args: string[] };
export function executorProcessCommand(input: Pick<PiProcessInput, "env" | "file" | "args">, ready: string, entry?: ExecutorProcessEntry) {
  const command = entry ?? { file: process.execPath, args: [fileURLToPath(new URL("./process-entry.ts", import.meta.url))] };
  return [command.file, ...command.args, JSON.stringify(Object.keys(input.env)), ready, input.file, ...input.args];
}

/** Trusted composition hook for the existing PiRun. No RPC parser or daemon lives here. */
export function createExecutorLauncher(store: ExecutorJournal, assignment: ExecutorAssignment, beginSpawn?: () => LocalJournal, entry?: ExecutorProcessEntry) {
  return (input: PiProcessInput): PiProcess => {
    const version = spawnSync("systemd-run", ["--version"], { encoding: "utf8", timeout: 4000 });
    if (process.platform !== "linux" || !version.stdout.startsWith("systemd 262 ")) throw new Error("Executor requires verified Linux systemd 262");
    const remaining = new Date(assignment.deadlineAt).getTime() - Date.now();
    if (remaining <= 0) throw new Error("Assignment deadline expired");
    let value = beginSpawn ? store.read(assignmentUnit(assignment))! : store.intent(assignment);
    if (inspectExecutorUnit(value.unit).LoadState !== "not-found") {
      store.write({ ...value, launchState: "unknown", journal: { ...value.journal, phase: "unknown" } });
      throw new Error("Unit already exists; reconcile without launch");
    }
    const ready = join(store.directory, `${value.unit}.${randomUUID()}.ready`);
    const args = ["--user", "--quiet", "--pipe", "--service-type=exec", `--unit=${value.unit}`, "--property=KillMode=control-group", "--property=ExitType=cgroup", "--property=RemainAfterExit=yes", "--property=TimeoutStopSec=2s", `--property=RuntimeMaxSec=${Math.ceil(remaining / 1000) + 5}s`, "--property=MemoryMax=8G", "--property=MemorySwapMax=1G", "--property=TasksMax=128", `--working-directory=${input.cwd}`, ...Object.keys(input.env).filter(key => input.env[key] !== undefined).map(key => `--setenv=${key}`), "--", ...executorProcessCommand(input, ready, entry)];
    value = beginSpawn ? beginSpawn() : store.write({ ...value, launchState: "spawn_possible" });
    const child = spawn("systemd-run", args, { env: { ...input.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS }, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let failure: Error | null = null, pendingSignal: NodeJS.Signals | null = null, finished = false;
    child.once("error", () => { failure = new Error("Executor launcher failed"); });
    const command = (signal: NodeJS.Signals) => {
      value = store.read(value.unit)!;
      if (!value.journal.identity) { pendingSignal = signal; return; }
      const properties = inspectExecutorUnit(value.unit);
      if (!propertiesMatch(properties, value)) throw new Error("Refuse signal to changed invocation");
      value = store.write({ ...value, journal: { ...value.journal, phase: "stopping" } });
      systemctl(["kill", "--kill-whom=all", `--signal=${signal}`, value.unit]);
      const latest = store.read(value.unit)!;
      const signals = [...latest.signals, { signal, at: new Date().toISOString() }];
      value = store.write({ ...latest, signals: signals.length > 4 ? [...signals.slice(0, 3), signals.at(-1)!] : signals });
    };
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const requestStop = (signal: NodeJS.Signals) => {
      command(signal);
      if (signal !== "SIGKILL" && !escalation) escalation = setTimeout(() => {
        try { command("SIGKILL"); } catch (error) { failure = error instanceof Error ? error : new Error("Owned stop failed"); }
      }, 2000);
    };
    const deadline = setTimeout(() => { try { requestStop("SIGTERM"); } catch (error) { failure = error instanceof Error ? error : new Error("Owned deadline stop failed"); } }, remaining);
    const closed = supervise().finally(() => { clearTimeout(deadline); clearTimeout(escalation); });
    async function acquireIdentity() {
      const launchUntil = Date.now() + 4000;
      while (Date.now() < launchUntil) {
        if (failure) throw failure;
        const properties = inspectExecutorUnit(value.unit);
        if (properties.InvocationID && properties.ControlGroup && properties.ActiveState === "active" && properties.SubState === "running") {
          const identity = executorProcessIdentitySchema.parse({ bootId: bootId(), unit: value.unit, invocationId: properties.InvocationID, controlGroup: properties.ControlGroup });
          value = store.read(value.unit)!;
          value = store.write({ ...value, supervisionRoot: cgroupRootIdentity(), journal: { ...value.journal, identity, phase: "owned" } });
          if (pendingSignal) command(pendingSignal);
          else closeSync(openSync(ready, "wx", 0o600));
          return;
        }
        await Bun.sleep(50);
      }
      throw new Error("Launch identity unavailable; reconcile without relaunch");
    }
    async function supervise(): PiProcess["closed"] {
      try {
        await acquireIdentity();
        for (;;) {
          if (failure) throw failure;
          value = store.read(value.unit)!;
          const properties = inspectExecutorUnit(value.unit), observation = observeExecutorStop(value, properties);
          if (observation) {
            value = store.write({ ...value, observation });
            finished = true;
            systemctl(["stop", value.unit]);
            return { code: properties.ExecMainCode === "1" ? Number(properties.ExecMainStatus) : null, signal: properties.ExecMainCode !== "1" ? properties.ExecMainStatus! : null };
          }
          await Bun.sleep(100);
        }
      } catch (error) {
        if (!finished) {
          try { value = store.read(value.unit)!; value = store.write({ ...value, journal: { ...value.journal, phase: "unknown" } }); } catch { /* The original intent stays durable. */ }
        }
        throw error;
      }
    }
    return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, closed, kill(signal) {
      if (finished) return;
      try { requestStop(signal); } catch (error) { failure = error instanceof Error ? error : new Error("Owned stop failed"); }
    } };
  };
}

/** Explicit recovery stop; never creates a replacement process or trusts a PID. */
export function stopRecoveredExecutorProcess(store: ExecutorJournal, unit: string) {
  const recovered = recoverExecutorProcess(store, unit);
  if (recovered.state === "stopped") return;
  if (recovered.state !== "owned") throw new Error("Recovered invocation ownership unknown");
  const value = recovered.value, properties = inspectExecutorUnit(unit);
  if (!propertiesMatch(properties, value)) throw new Error("Recovered invocation changed");
  store.write({ ...value, journal: { ...value.journal, phase: "stopping" } });
  systemctl(["kill", "--kill-whom=all", "--signal=SIGKILL", unit]);
}

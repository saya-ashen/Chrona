import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { spawnWindowsGuardian } from "./windows-transport";

export type ProcessCapability = {
  available: boolean;
  backend: "posix-guardian" | "windows-job" | "unsupported";
  platform: string;
  validation: "linux-local" | "pending";
  scope: "descendants" | "process-group";
  treeClean: false;
  reason?: string;
};
export type ProcessStopEvidence = {
  state: "stopped" | "unknown";
  scope: "descendants" | "process-group";
  /** True only after native descendant-empty proof (Linux ECHILD or Windows Job accounting). */
  treeClean: boolean;
  reason: string;
};
export type SupervisedExit = {
  code: number | null;
  signal: string | null;
  stop: ProcessStopEvidence;
};
export type SupervisedProcessOptions = {
  stopReceipt?: { path: string; generation: string };
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  helperPath?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function helperLocation(helperPath?: string, platform = process.platform) {
  return helperPath ?? process.env.CHRONA_PROCESS_HELPER ?? fileURLToPath(new URL(`../bin/${platform}-${process.arch}/chrona-process-guardian${platform === "win32" ? ".exe" : ""}`, import.meta.url));
}

/** Capability is checked on demand, so an unsupported backend never blocks startup. */
export function processCapability({ helperPath, platform = process.platform }: { helperPath?: string; platform?: string } = {}): ProcessCapability {
  const base = { platform, validation: platform === "linux" ? "linux-local" as const : "pending" as const, scope: platform === "linux" || platform === "win32" ? "descendants" as const : "process-group" as const, treeClean: false as const };
  if (platform !== "linux" && platform !== "darwin" && platform !== "win32") return { ...base, available: false, backend: "unsupported", reason: "No process supervision backend for this platform" };
  try {
    const helper = helperLocation(helperPath, platform);
    if (!isAbsolute(helper) || !statSync(helper).isFile()) throw new Error("invalid helper path");
    accessSync(helper, constants.X_OK);
    return { ...base, available: true, backend: platform === "win32" ? "windows-job" : "posix-guardian" };
  } catch {
    return { ...base, available: false, backend: "unsupported", reason: "Native process guardian missing or not executable; build/package it or set CHRONA_PROCESS_HELPER to its absolute path" };
  }
}

export class ProcessSupervisionUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "ProcessSupervisionUnavailableError"; }
}
export class ProcessStopUnknownError extends Error {
  constructor(readonly evidence: ProcessStopEvidence) { super(`Process stop unknown: ${evidence.reason}`); this.name = "ProcessStopUnknownError"; }
}
/** Use at boundaries where a completed result can release execution capacity. */
export function requireDescendantStop(exit: SupervisedExit): SupervisedExit {
  if (exit.stop.state !== "stopped" || exit.stop.scope !== "descendants" || !exit.stop.treeClean) throw new ProcessStopUnknownError(exit.stop);
  return exit;
}

/**
 * Run an argv directly under an independent native guardian. The returned Node
 * process is the guardian: its PID is NOT the task PID (available through ready).
 * Keep its private pipes open. Use stop(), never process.kill()/process.kill(-pid).
 * Killing the JS owner closes fd 3 (POSIX) or its named pipe (Windows) in the kernel.
 */
export function spawnSupervised(command: string, args: readonly string[] = [], options: SupervisedProcessOptions = {}) {
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error("Invalid process timeout");
  if (options.signal?.aborted) throw options.signal.reason ?? new Error("Process launch aborted");
  const capability = processCapability(options);
  if (!capability.available) throw new ProcessSupervisionUnavailableError(capability.reason!);
  const receipt = options.stopReceipt;
  if (receipt && (process.platform !== "linux" || !isAbsolute(receipt.path) || !/^[a-f0-9]{64}$/.test(receipt.generation))) throw new Error("Durable stop receipts require Linux, an absolute path and a unique generation");
  const receiptArgs = receipt ? ["--receipt", receipt.path, receipt.generation, "--"] : [];
  const spawnOptions = { cwd: options.cwd, env: options.env, detached: true };
  const windows = process.platform === "win32" ? spawnWindowsGuardian(helperLocation(options.helperPath), command, args, spawnOptions) : undefined;
  const child = windows?.child ?? spawn(helperLocation(options.helperPath), [...receiptArgs, command, ...args], {
    ...spawnOptions, stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  const control = windows?.control ?? child.stdio[3] as Writable | null;
  const status = windows?.status ?? child.stdio[4] as Readable | null;
  let stopRequested = false;
  const stop = () => {
    if (stopRequested) return;
    stopRequested = true;
    // Owner EOF also requests stop; the private channel is never inherited by tasks.
    control?.end("K");
  };
  let resolveReady!: (ready: { pid: number; groupId: number }) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<{ pid: number; groupId: number }>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Callers that only wait for exited should not receive an unhandled rejection.
  void ready.catch(() => {});
  let record: { code: number; signal: number; reason: string; groupStopped: boolean; descendantsStopped: boolean } | undefined;
  let buffer = "", invalid = false, readySeen = false;
  status?.setEncoding("utf8");
  status?.on("data", (chunk: string) => {
    if (invalid) return;
    buffer += chunk;
    if (buffer.length > 4096) { buffer = ""; invalid = true; stop(); return; }
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n"), line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const value = JSON.parse(line);
        if (value.event === "ready" && !readySeen && value.version === 1 && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid === value.groupId) {
          readySeen = true;
          resolveReady({ pid: value.pid, groupId: value.groupId });
        } else if (value.event === "exit" && readySeen && !record && Number.isSafeInteger(value.code) && Number.isSafeInteger(value.signal) && typeof value.reason === "string" && typeof value.groupStopped === "boolean" && typeof value.descendantsStopped === "boolean") record = value;
        else { invalid = true; stop(); }
      } catch { invalid = true; stop(); }
    }
  });
  // Pipe errors are absence of evidence, never evidence of a successful stop.
  control?.on("error", () => { invalid = true; });
  status?.on("error", () => { invalid = true; stop(); });
  const abort = () => stop();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(stop, options.timeoutMs);
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const exited = new Promise<SupervisedExit>((resolve, reject) => {
    child.once("error", error => { rejectReady(error); reject(error); });
    child.once("exit", () => {
      // A failed guardian or an escaped descendant can retain stdout/stderr.
      // Bound waiting for inherited pipes; missing evidence stays unknown.
      drainTimer = setTimeout(() => {
        invalid = true;
        child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
        status?.destroy(); control?.destroy();
      }, 250);
    });
    child.once("close", async (code, signal) => {
      // Windows status arrives on a separate pipe, outside ChildProcess stdio.
      // Retain the drain deadline until its last record/EOF has been delivered.
      if (windows) await windows.statusFinished;
      windows?.dispose();
      clearTimeout(timer);
      clearTimeout(drainTimer);
      options.signal?.removeEventListener("abort", abort);
      rejectReady(new Error("Guardian exited before readiness"));
      const evidence = !invalid && !buffer ? record : undefined;
      const taskSignal = evidence ? evidence.signal ? Object.entries(osConstants.signals).find(([, number]) => number === evidence.signal)?.[0] ?? `signal:${evidence.signal}` : null : signal;
      resolve({
        code: evidence ? evidence.code < 0 ? null : evidence.code : code,
        signal: taskSignal ?? null,
        stop: {
          state: evidence && (capability.scope === "descendants" ? evidence.descendantsStopped : evidence.groupStopped) ? "stopped" : "unknown",
          scope: capability.scope,
          treeClean: Boolean(evidence && capability.scope === "descendants" && evidence.descendantsStopped),
          reason: evidence ? evidence.reason : "Guardian exited without valid stop evidence",
        },
      });
    });
  });
  if (options.signal?.aborted) stop();
  return { process: child, pid: child.pid, ready, exited, stop, capability };
}

/** A receipt proves only termination of the original generation, never business success. */
export async function readStopReceipt(expected: { path: string; generation: string }): Promise<ProcessStopEvidence> {
  if (process.platform !== "linux" || !/^[a-f0-9]{64}$/.test(expected.generation)) throw new Error("Unsupported stop receipt");
  const file = await open(expected.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (![stat.isFile(), stat.size <= 512, stat.nlink === 1, (stat.mode & 0o077) === 0, stat.uid === process.getuid?.()].every(Boolean)) throw new Error("Invalid stop receipt storage");
    const value = JSON.parse(await file.readFile("utf8"));
    if (![value.version === 1, value.generation === expected.generation, value.state === "stopped", value.scope === "descendants", value.treeClean === true].every(Boolean)) throw new Error("Unconfirmed descendant stop");
    // A reader may race the guardian's final fsync; establish durability before accepting it.
    await file.sync();
    const directory = await open(dirname(expected.path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
    return { state: "stopped", scope: "descendants", treeClean: true, reason: "durable-generation-stop" };
  } finally { await file.close(); }
}

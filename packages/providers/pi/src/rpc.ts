import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";

export type RecordValue = Record<string, unknown>;
export type PiRpcClosureSource = "stdout" | "bridge_fd4" | "process_exit";

export class PiRpcClosedBeforeCompletionError extends Error {
  constructor(
    readonly source: PiRpcClosureSource,
    readonly exitCode: number | null = null,
    readonly exitSignal: string | null = null,
  ) {
    const exit = source === "process_exit" || exitCode !== null || exitSignal !== null
      ? ` (code ${exitCode}, signal ${exitSignal ?? "none"})`
      : "";
    super(source === "process_exit"
      ? `Pi exited before completion${exit}`
      : `Pi RPC ${source.replace("_", " ")} closed before completion${exit}`);
  }
}

export function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_CHUNK_BYTES = 4096;
const MAX_STDERR_CHUNKS = 128;
const MAX_STDERR_CLASSES = 4;
const ANSI_ESCAPE = 0x1b;

type StderrMatcher = {
  readonly label: PiStderrClass;
  readonly token: string;
  progress: number;
  pendingBoundary: boolean;
};

export type PiStderrClass =
  | "aggregate_error"
  | "eval_error"
  | "range_error"
  | "reference_error"
  | "syntax_error"
  | "type_error"
  | "uri_error"
  | "broken_pipe"
  | "memory_exhausted"
  | "missing_resource"
  | "native_signal"
  | "permission_denied"
  | "resource_exhausted"
  | "uncaught_exception"
  | "unhandled_rejection";

const STDERR_TOKENS: ReadonlyArray<readonly [PiStderrClass, string]> = [
  ["aggregate_error", "aggregateerror"],
  ["eval_error", "evalerror"],
  ["range_error", "rangeerror"],
  ["reference_error", "referenceerror"],
  ["syntax_error", "syntaxerror"],
  ["type_error", "typeerror"],
  ["uri_error", "urierror"],
  ["memory_exhausted", "javascript heap out of memory"],
  ["memory_exhausted", "reached heap limit"],
  ["memory_exhausted", "call_and_retry_last"],
  ["unhandled_rejection", "unhandledpromiserejection"],
  ["unhandled_rejection", "unhandled rejection"],
  ["uncaught_exception", "uncaught exception"],
  ["uncaught_exception", "uncaughtexception"],
  ["permission_denied", "eacces"],
  ["missing_resource", "enoent"],
  ["broken_pipe", "epipe"],
  ["resource_exhausted", "emfile"],
  ["resource_exhausted", "enfile"],
  ["native_signal", "sigabrt"],
  ["native_signal", "sigsegv"],
  ["native_signal", "sigill"],
  ["native_signal", "sigbus"],
];

/**
 * Inspects bounded stderr samples with numeric matcher state only; it never
 * retains decoded stderr or arbitrary text. Labels are observations, not cause
 * or provenance claims.
 */
export class PiStderrClassifier {
  private readonly classes: PiStderrClass[] = [];
  private readonly matchers: StderrMatcher[] = STDERR_TOKENS.map(([label, token]) => ({ label, token, progress: 0, pendingBoundary: false }));
  private sawStderr = false;
  private chunks = 0;
  private previousIsWord = false;
  private ansiState: "none" | "escape" | "csi" = "none";
  private ansiBytes = 0;

  push(chunk: Buffer | string) {
    this.sawStderr = true;
    if (this.chunks >= MAX_STDERR_CHUNKS || this.classes.length >= MAX_STDERR_CLASSES) return;
    this.chunks++;
    const length = chunk.length;
    if (length <= MAX_STDERR_CHUNK_BYTES) {
      this.inspect(chunk, 0, length);
      return;
    }
    // Inspect independent bounded samples. Never bridge an omitted middle span.
    const sample = MAX_STDERR_CHUNK_BYTES / 2;
    this.inspect(chunk, 0, sample);
    this.resetMatchers();
    this.inspect(chunk, length - sample, length);
  }

  finish() {
    for (const matcher of this.matchers) if (matcher.pendingBoundary) this.record(matcher.label);
    this.resetMatchers();
  }

  summary() {
    if (this.classes.length) return `stderr_classes=${this.classes.join(",")}`;
    return `stderr_class=${this.sawStderr ? "unknown" : "none"}`;
  }

  private inspect(chunk: Buffer | string, start: number, end: number) {
    for (let index = start; index < end; index++) this.inspectCode(typeof chunk === "string" ? chunk.charCodeAt(index) : chunk[index]!);
  }

  private inspectCode(code: number) {
    if (this.consumeAnsi(code)) return;
    if (code === ANSI_ESCAPE) { this.ansiState = "escape"; return; }

    const normalized = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
    const isWord = (normalized >= 0x61 && normalized <= 0x7a) || (normalized >= 0x30 && normalized <= 0x39) || normalized === 0x5f;
    for (const matcher of this.matchers) this.inspectMatcher(matcher, normalized, isWord);
    this.previousIsWord = isWord;
  }

  private consumeAnsi(code: number) {
    if (this.ansiState === "escape") {
      this.ansiState = code === 0x5b ? "csi" : "none";
      this.ansiBytes = 0;
      return code === 0x5b;
    }
    if (this.ansiState !== "csi") return false;
    if (++this.ansiBytes <= 32 && code >= 0x20 && code <= 0x3f) return true;
    this.ansiState = "none";
    this.ansiBytes = 0;
    return code >= 0x40 && code <= 0x7e;
  }

  private inspectMatcher(matcher: StderrMatcher, normalized: number, isWord: boolean) {
    if (matcher.pendingBoundary) {
      if (!isWord) this.record(matcher.label);
      matcher.pendingBoundary = false;
    }
    const expected = matcher.token.charCodeAt(matcher.progress);
    if (normalized === expected && (matcher.progress > 0 || !this.previousIsWord)) {
      matcher.progress++;
      if (matcher.progress === matcher.token.length) {
        matcher.progress = 0;
        matcher.pendingBoundary = true;
      }
      return;
    }
    matcher.progress = normalized === matcher.token.charCodeAt(0) && !this.previousIsWord ? 1 : 0;
  }

  private record(label: PiStderrClass) {
    if (this.classes.length < MAX_STDERR_CLASSES && !this.classes.includes(label)) this.classes.push(label);
  }

  private resetMatchers() {
    for (const matcher of this.matchers) { matcher.progress = 0; matcher.pendingBoundary = false; }
    this.previousIsWord = false;
    this.ansiState = "none";
    this.ansiBytes = 0;
  }
}

/** Pi RPC is LF-delimited JSONL, NOT readline's Unicode line protocol. */
export function readJsonl(stream: Readable, onRecord: (value: RecordValue) => void, onError: (error: Error) => void, onEnd?: () => void) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const consume = (text: string) => {
    buffer += text;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_FRAME_BYTES) throw new Error("Pi RPC frame exceeds the limit");
      if (line.trim()) onRecord(record(JSON.parse(line)));
      newline = buffer.indexOf("\n");
    }
    if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) throw new Error("Pi RPC frame exceeds the limit");
  };
  stream.on("data", (chunk: Buffer | string) => {
    try { consume(typeof chunk === "string" ? chunk : decoder.write(chunk)); }
    catch { onError(new Error("Pi emitted invalid or oversized JSONL")); }
  });
  stream.on("end", () => {
    try { consume(decoder.end()); if (buffer.trim()) throw new Error("incomplete frame"); else onEnd?.(); }
    catch { onError(new Error("Pi closed an incomplete JSONL frame")); }
  });
  stream.on("error", () => onError(new Error("Pi RPC pipe failed")));
}

export type RpcLaunch = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  onEvent: (event: RecordValue) => void;
  onBridge: (event: RecordValue) => void;
  onFailure: (error: Error) => void;
};

type Pending = {
  type: string;
  resolve: (data: RecordValue) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class PiRpc {
  readonly child: ChildProcess;
  private readonly pending = new Map<string, Pending>();
  private readonly stderrClassifier = new PiStderrClassifier();
  private nextId = 0;
  private closed = false;
  private failed = false;
  private pendingPipeEnd?: ReturnType<typeof setTimeout>;
  private closing?: Promise<void>;

  constructor(private readonly launch: RpcLaunch) {
    this.child = spawn(launch.command, launch.args, {
      cwd: launch.cwd, env: launch.env, shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const fail = (error: Error) => this.fail(error);
    // Neither a clean EOF nor exit code 0 proves agent_settled was received.
    // Do not wait for the model deadline when an IPC channel is already gone.
    // Keep only bounded transport facts; stderr may contain private extension data.
    const ended = (source: "stdout" | "bridge_fd4") => this.failAfterPipeEnd(source);
    readJsonl(this.child.stdout!, (event) => this.receive(event), fail, () => ended("stdout"));
    readJsonl(this.child.stdio[4] as Readable, launch.onBridge, fail, () => ended("bridge_fd4"));
    // Classify bounded stderr evidence into fixed labels without retaining or logging text.
    this.child.stderr!.on("data", (chunk: Buffer | string) => this.stderrClassifier.push(chunk));
    this.child.stderr!.on("end", () => this.stderrClassifier.finish());
    for (const stream of [this.child.stdin!, this.child.stdio[3]!]) stream.on("error", () => fail(new Error("Pi input pipe failed")));
    this.child.on("error", () => fail(new Error("Cannot start Pi. Install Pi >= 0.85.0 and check the executable and working directory.")));
    const exited = (code: number | null, signal: string | null) => {
      // A later SIGTERM/SIGKILL after close() is Chrona cleanup, not a cause.
      if (this.closed) return;
      this.clearPendingPipeEnd();
      fail(new PiRpcClosedBeforeCompletionError("process_exit", code, signal));
    };
    this.child.on("exit", exited);

  }

  private failAfterPipeEnd(source: "stdout" | "bridge_fd4") {
    if (this.closed || this.failed || this.pendingPipeEnd) return;
    // Give an already-exiting child one event-loop turn to report its real exit
    // code/signal before cleanup can send its own termination signal.
    this.pendingPipeEnd = setTimeout(() => {
      this.pendingPipeEnd = undefined;
      this.fail(new PiRpcClosedBeforeCompletionError(source, this.child.exitCode, this.child.signalCode));
    }, 0);
  }

  private clearPendingPipeEnd() {
    if (this.pendingPipeEnd) clearTimeout(this.pendingPipeEnd);
    this.pendingPipeEnd = undefined;
  }

  private fail(error: Error) {
    if (this.closed || this.failed) return;
    this.clearPendingPipeEnd();
    this.failed = true;
    this.rejectPending(error);
    this.launch.onFailure(error);
  }

  private receive(event: RecordValue) {
    if (event.type !== "response") { this.launch.onEvent(event); return; }
    const id = typeof event.id === "string" ? event.id : "";
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (event.success === true) pending.resolve(record(event.data));
    else pending.reject(new Error(`Pi rejected ${pending.type}. Check the selected model, login and extension compatibility.`));
  }

  stderrDiagnostics() { this.stderrClassifier.finish(); return this.stderrClassifier.summary(); }

  request(type: string, values: RecordValue = {}): Promise<RecordValue> {
    if (this.closed || this.failed) return Promise.reject(new Error("Pi RPC is unavailable"));
    const id = `chrona-${++this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi ${type} timed out`));
      }, this.launch.timeoutMs);
      this.pending.set(id, { type, resolve, reject, timer });
      this.send({ ...values, id, type });
    });
  }

  send(value: RecordValue) {
    if (!this.closed) this.child.stdin!.write(`${JSON.stringify(value)}\n`);
  }

  bridge(value: RecordValue) {
    if (this.closed || this.failed) return false;
    (this.child.stdio[3] as Writable).write(`${JSON.stringify(value)}\n`);
    return true;
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.clearPendingPipeEnd();
    this.rejectPending(new Error("Pi RPC closed"));
    this.closing = new Promise<void>((resolve) => {
      if (!this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null) { this.signal("SIGKILL"); this.destroyPipes(); resolve(); return; }
      const finish = () => {
        clearTimeout(timer);
        this.child.removeListener("exit", finish);
        // Also stop descendants that outlived the Pi parent in its process group.
        this.signal("SIGKILL");
        this.destroyPipes();
        resolve();
      };
      const timer = setTimeout(finish, 1500);
      this.child.once("exit", finish);
      this.child.stdin?.end();
      (this.child.stdio[3] as Writable | null)?.end();
      this.signal("SIGTERM");
    });
    return this.closing;
  }

  private destroyPipes() {
    // Closing only writable stdin leaves read ends (including bridge fd4) alive
    // on runtimes that defer child cleanup until every stdio handle is closed.
    for (const stream of this.child.stdio) stream?.destroy();
  }

  private signal(signal: NodeJS.Signals) {
    if (!this.child.pid) return;
    try {
      if (process.platform === "win32") this.child.kill(signal);
      else process.kill(-this.child.pid, signal);
    } catch { /* Process group has already exited. */ }
  }
}

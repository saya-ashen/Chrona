import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";

export type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

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
  private nextId = 0;
  private closed = false;
  private failed = false;
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
    const ended = () => fail(new Error("Pi RPC closed before completion; no fallback was attempted."));
    readJsonl(this.child.stdout!, (event) => this.receive(event), fail, ended);
    readJsonl(this.child.stdio[4] as Readable, launch.onBridge, fail, ended);
    // Drain without retaining/logging private extension diagnostics or credentials.
    this.child.stderr!.resume();
    for (const stream of [this.child.stdin!, this.child.stdio[3]!]) stream.on("error", () => fail(new Error("Pi input pipe failed")));
    this.child.on("error", () => fail(new Error("Cannot start Pi. Install Pi >= 0.85.0 and check the executable and working directory.")));
    const exited = (code: number | null, signal: string | null) => {
      if (!this.closed) fail(new Error(`Pi exited before completion (code ${code}, signal ${signal}). Check its configuration and extension compatibility; no fallback was attempted.`));
    };
    this.child.on("exit", exited);

  }

  private fail(error: Error) {
    if (this.closed || this.failed) return;
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
    if (!this.closed) (this.child.stdio[3] as Writable).write(`${JSON.stringify(value)}\n`);
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
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

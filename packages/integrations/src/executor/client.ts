import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { EXECUTOR_HTTP, EXECUTOR_LIMITS, executorRequestSchemas, parseExecutorResponse, type ExecutorOperation, type ExecutorRequests, type ExecutorResponses } from "@chrona/contracts/steward";

/** Host supplies a private local path; the credential exists durably before pairing. */
export function executorCredential(path: string): string {
  let stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) {
    const fd = openSync(`${path}.next`, "wx", 0o600);
    try { writeFileSync(fd, randomBytes(32).toString("hex")); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(`${path}.next`, path);
    const directory = openSync(dirname(path), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
    stat = lstatSync(path);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size !== 64) throw new Error("Unsafe executor credential file");
  const credential = readFileSync(path, "utf8");
  if (!/^[a-f0-9]{64}$/.test(credential)) throw new Error("Invalid executor credential file");
  return credential;
}

async function readExecutorResponse(response: Response) {
        if (!response.body) throw new Error("Executor response missing");
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > EXECUTOR_LIMITS.bodyBytes) throw new Error("Executor response capacity reached");
            chunks.push(next.value);
          }
        } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export function createExecutorClient(origin: string, credential: string) {
  const base = new URL(origin);
  if (base.username || base.password || base.pathname !== "/" || base.search || base.hash || !["https:", "http:"].includes(base.protocol)) throw new Error("Executor requires a fixed HTTP origin");
  if (!/^[a-f0-9]{64}$/.test(credential)) throw new Error("Invalid executor credential");
  const busy = new Set<ExecutorOperation>();
  return {
    async request<K extends ExecutorOperation>(op: K, raw: ExecutorRequests[K], signal?: AbortSignal): Promise<ExecutorResponses[K]> {
      const input = executorRequestSchemas[op].parse(raw), body = JSON.stringify(input);
      if (Buffer.byteLength(body) > EXECUTOR_HTTP[op].bytes) throw new Error("Executor request capacity reached");
      enterRequest(busy, op);
      try {
        const response = await fetch(new URL(EXECUTOR_HTTP[op].path, base), { method: "POST", redirect: "error", credentials: "omit", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body,
          signal: requestSignal(signal) }).catch(() => { throw new ExecutorTransportError(); });
        const rawResponse = await readExecutorResponse(response);
        const envelope = parseExecutorResponse(op, input.requestId, rawResponse);
        if (!("data" in envelope)) throw new ExecutorRequestError("error" in envelope ? envelope.error.code : "invalid");
        const data = envelope.data as ExecutorResponses[K];
        if ("incarnation" in input && "incarnation" in data && (input.executorId !== data.executorId || input.generation !== data.generation || input.incarnation !== data.incarnation)) throw new Error("Executor response fence mismatch");
        if (signal?.aborted) throw new Error("Executor response arrived after disconnect");
        return data;
      } finally { busy.delete(op); }
    },
  };
}

/** Every actual daemon startup proposes a fresh, durable incarnation; owner explicitly transfers from previous. */
export function prepareExecutorIncarnation(path: string) {
  const previous = lstatSync(path, { throwIfNoEntry: false });
  if (previous && (!previous.isFile() || previous.isSymbolicLink() || previous.mode & 0o077 || previous.size > 128)) throw new Error("Unsafe executor incarnation file");
  const expectedIncarnation = previous ? readFileSync(path, "utf8") : null;
  const nextIncarnation = randomBytes(32).toString("hex"), fd = openSync(`${path}.next`, "wx", 0o600);
  try { writeFileSync(fd, nextIncarnation); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(`${path}.next`, path);
  const directory = openSync(dirname(path), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return { expectedIncarnation, nextIncarnation };
}

export class ExecutorRequestError extends Error { constructor(readonly code: string) { super(`Executor request rejected: ${code}`); } }

function requestSignal(signal?: AbortSignal) { const timeout = AbortSignal.timeout(EXECUTOR_LIMITS.requestTimeoutMs); return signal ? AbortSignal.any([signal, timeout]) : timeout; }

export class ExecutorTransportError extends Error { constructor() { super("Executor transport unavailable"); } }

function enterRequest(busy: Set<ExecutorOperation>, op: ExecutorOperation) {
  if (!["poll", "report"].includes(op)) return;
  if (busy.has(op)) throw new Error("Executor operation already in flight");
  busy.add(op);
}

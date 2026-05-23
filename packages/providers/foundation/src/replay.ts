import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ProviderRunEvent,
  ProviderRunRef,
  ProviderRunSnapshot,
  StartRunInput,
} from "./contracts/provider";

export type ProviderReplayStartRecord = {
  kind: "start";
  provider: string;
  recordedAt: string;
  input?: unknown;
  run: ProviderRunRef;
};

export type ProviderReplayEventRecord = {
  kind: "event";
  provider: string;
  recordedAt: string;
  event: ProviderRunEvent;
};

export type ProviderReplaySnapshotRecord = {
  kind: "snapshot";
  provider: string;
  recordedAt: string;
  snapshot: ProviderRunSnapshot;
};

export type ProviderReplayRecord =
  | ProviderReplayStartRecord
  | ProviderReplayEventRecord
  | ProviderReplaySnapshotRecord;

export type ProviderReplayTape = {
  path: string;
  records: ProviderReplayRecord[];
  start?: ProviderReplayStartRecord;
  events: ProviderRunEvent[];
  snapshot?: ProviderRunSnapshot;
};

export function replayPathForRun(directory: string, runId: string): string {
  return join(directory, `${sanitizeReplayName(runId)}.jsonl`);
}

export function providerReplayRecord(
  provider: string,
  run: ProviderRunRef,
  input: StartRunInput,
): ProviderReplayStartRecord {
  return {
    kind: "start",
    provider,
    recordedAt: new Date().toISOString(),
    input: sanitizeReplayValue(input),
    run,
  };
}

export async function appendProviderReplayRecord(
  path: string,
  record: ProviderReplayRecord,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record)}\n`, { flag: "a" });
}

export async function readProviderReplayTape(
  path: string,
): Promise<ProviderReplayTape> {
  const content = await readFile(path, "utf8");
  const records = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProviderReplayRecord);
  const start = records.find(
    (record): record is ProviderReplayStartRecord => record.kind === "start",
  );
  const events = records.flatMap((record) =>
    record.kind === "event" ? [record.event] : [],
  );
  const snapshot = records.findLast(
    (record): record is ProviderReplaySnapshotRecord =>
      record.kind === "snapshot",
  )?.snapshot;

  return { path, records, start, events, snapshot };
}

export function terminalSnapshotFromEvents(
  events: ProviderRunEvent[],
): ProviderRunSnapshot | undefined {
  const terminal = events.findLast((event) =>
    event.type === "run_completed" ||
    event.type === "run_failed" ||
    event.type === "run_cancelled"
  );
  if (!terminal) {
    return undefined;
  }
  if (terminal.type === "run_completed") {
    const runId = terminal.runId ?? terminal.run.runId;
    const sessionId = terminal.sessionId ?? terminal.run.sessionId;
    const provider = terminal.provider ?? terminal.run.provider;
    if (!runId || !sessionId || !provider) {
      return undefined;
    }
    return {
      provider,
      runId,
      nativeRunId: terminal.nativeRunId,
      providerRunId: terminal.run.providerRunId ?? terminal.run.runId,
      sessionId,
      status: "completed",
      outputText: terminal.outputText,
      output: terminal.output,
      usage: terminal.usage,
      error: null,
      raw: terminal.raw,
    };
  }
  const terminalRun = terminal.run;
  const runId = terminal.runId ?? terminalRun?.runId;
  const provider = terminal.provider ?? terminalRun?.provider;
  if (!runId || !provider) {
    return undefined;
  }
  const sessionId = terminal.sessionId ?? terminalRun?.sessionId;
  if (!sessionId) {
    return undefined;
  }
  return {
    provider,
    runId,
    nativeRunId: terminal.nativeRunId,
    providerRunId: terminalRun?.providerRunId ?? terminalRun?.runId ?? runId,
    sessionId,
    status: terminal.type === "run_failed" ? "failed" : "cancelled",
    error: terminal.type === "run_failed" ? terminal.error : null,
    raw: terminal.raw,
  };
}

function sanitizeReplayName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "run";
}

function sanitizeReplayValue(value: unknown): unknown {
  if (value instanceof AbortSignal) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeReplayValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "signal") {
      continue;
    }
    record[key] = sanitizeReplayValue(entry);
  }
  return record;
}

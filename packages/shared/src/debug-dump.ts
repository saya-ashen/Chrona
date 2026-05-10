import { mkdir, open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

type DebugDumpWriter = {
  filePath: string;
  write(entry: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
};

function isEnabled(name: string) {
  return ["1", "true", "yes", "on"].includes(
    (process.env[name] ?? "").trim().toLowerCase(),
  );
}

function safeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96) || "unknown";
}

function defaultDirectory(kind: string) {
  return join(process.cwd(), ".chrona-debug", kind);
}

async function appendJsonLine(handle: FileHandle, entry: Record<string, unknown>) {
  await handle.appendFile(
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`,
  );
}

export async function createDebugDump(input: {
  enabledEnv: string;
  directoryEnv?: string;
  kind: string;
  label: string;
  meta?: Record<string, unknown>;
}): Promise<DebugDumpWriter | null> {
  if (!isEnabled(input.enabledEnv)) {
    return null;
  }

  const directory = process.env[input.directoryEnv ?? ""]?.trim() || defaultDirectory(input.kind);
  await mkdir(directory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = join(directory, `${timestamp}-${safeSegment(input.label)}.jsonl`);
  const handle = await open(filePath, "a");
  let closed = false;
  let queue = Promise.resolve();
  await appendJsonLine(handle, {
    type: "meta",
    kind: input.kind,
    label: input.label,
    ...(input.meta ?? {}),
  });

  return {
    filePath,
    write(entry) {
      if (closed) {
        return Promise.resolve();
      }

      queue = queue
        .then(() => {
          if (closed) return undefined;
          return appendJsonLine(handle, entry);
        })
        .catch(() => undefined);
      return queue;
    },
    close() {
      if (closed) {
        return queue;
      }

      closed = true;
      queue = queue.then(() => handle.close()).catch(() => undefined);
      return queue;
    },
  };
}

export function previewDebugValue(value: unknown, maxLength = 1200): unknown {
  if (typeof value === "string") {
    return value.length > maxLength
      ? `${value.slice(0, maxLength)}...(${value.length - maxLength} more chars)`
      : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => previewDebugValue(item, maxLength));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        previewDebugValue(nested, maxLength),
      ]),
    );
  }
  return value;
}

import { z } from "zod";

/** A decoded server-sent event frame. Fields without a value are represented by an empty string. */
export type ServerEventFrame = {
  event?: string;
  id?: string;
  retry?: number;
  data: string;
};

export class ServerEventStreamParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ServerEventStreamParseError";
  }
}

export type ParseServerEventStreamOptions = {
  signal?: AbortSignal;
};

/**
 * Decodes a WHATWG byte stream as UTF-8 and frames it according to the SSE
 * event-stream grammar. A final unterminated event is dispatched at EOF,
 * matching the EventSource processing model.
 */
// The parser implements the full SSE framing state machine in one streaming scope.
// eslint-disable-next-line complexity
export async function* parseServerEventStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseServerEventStreamOptions = {},
): AsyncGenerator<ServerEventFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const fields: { event?: string; id?: string; retry?: number; data: string[] } = { data: [] };
  let buffered = "";

  const dispatch = (): ServerEventFrame | undefined => {
    if (fields.data.length === 0) {
      fields.event = undefined;
      fields.id = undefined;
      fields.retry = undefined;
      return undefined;
    }
    const frame: ServerEventFrame = {
      ...(fields.event === undefined ? {} : { event: fields.event }),
      ...(fields.id === undefined ? {} : { id: fields.id }),
      ...(fields.retry === undefined ? {} : { retry: fields.retry }),
      data: fields.data.join("\n"),
    };
    fields.event = undefined;
    fields.id = undefined;
    fields.retry = undefined;
    fields.data = [];
    return frame;
  };

  // Field parsing follows the SSE grammar's complete line dispatch table.
  // eslint-disable-next-line complexity
  const consumeLine = (rawLine: string): ServerEventFrame | undefined => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) return dispatch();
    if (line.startsWith(":")) return undefined;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const valueWithOptionalSpace = colon === -1 ? "" : line.slice(colon + 1);
    const value = valueWithOptionalSpace.startsWith(" ")
      ? valueWithOptionalSpace.slice(1)
      : valueWithOptionalSpace;

    switch (field) {
      case "data":
        fields.data.push(value);
        break;
      case "event":
        fields.event = value;
        break;
      case "id":
        // Per the SSE grammar, values containing a NUL must be ignored.
        if (!value.includes("\0")) fields.id = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) fields.retry = Number(value);
        break;
      default:
        // Unknown fields are intentionally ignored by the SSE specification.
        break;
    }
    return undefined;
  };

  const abortError = () =>
    options.signal?.reason ?? new DOMException("The event stream was aborted", "AbortError");

  try {
    for (;;) {
      if (options.signal?.aborted) throw abortError();
      const result = await reader.read().catch((cause): never => {
        if (options.signal?.aborted) throw abortError();
        throw new ServerEventStreamParseError("Event stream read failed", { cause });
      });
      if (result.done) break;
      try {
        buffered += decoder.decode(result.value, { stream: true });
      } catch (cause) {
        throw new ServerEventStreamParseError("Event stream contains invalid UTF-8", { cause });
      }
      for (;;) {
        const newline = buffered.indexOf("\n");
        if (newline === -1) break;
        const frame = consumeLine(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
        if (frame) yield frame;
      }
    }

    try {
      buffered += decoder.decode();
    } catch (cause) {
      throw new ServerEventStreamParseError("Event stream contains invalid UTF-8", { cause });
    }
    if (buffered.length > 0) {
      const frame = consumeLine(buffered);
      if (frame) yield frame;
    }
    const trailingFrame = dispatch();
    if (trailingFrame) yield trailingFrame;
  } finally {
    if (options.signal?.aborted) await reader.cancel(options.signal.reason).catch(() => undefined);
    reader.releaseLock();
  }
}

/** Parses non-sentinel SSE data as a strict JSON value with frame context. */
export async function* parseJsonServerEventStream(
  stream: ReadableStream<Uint8Array>,
  options: ParseServerEventStreamOptions & { doneSentinel?: string } = {},
): AsyncGenerator<unknown> {
  for await (const frame of parseServerEventStream(stream, options)) {
    if (options.doneSentinel !== undefined && frame.data === options.doneSentinel) continue;
    try {
      yield JSON.parse(frame.data);
    } catch (cause) {
      throw new ServerEventStreamParseError(
        `Event stream contains malformed JSON data${frame.event ? ` for event ${JSON.stringify(frame.event)}` : ""}`,
        { cause },
      );
    }
  }
}

/** Runtime helper for consumers that accept a typed JSON event payload. */
export async function* parseTypedJsonServerEventStream<T>(
  stream: ReadableStream<Uint8Array>,
  schema: z.ZodType<T>,
  options: ParseServerEventStreamOptions & { doneSentinel?: string } = {},
): AsyncGenerator<T> {
  for await (const value of parseJsonServerEventStream(stream, options)) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new ServerEventStreamParseError("Event stream JSON failed schema validation", {
        cause: parsed.error,
      });
    }
    yield parsed.data;
  }
}

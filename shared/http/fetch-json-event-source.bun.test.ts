import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { fetchJsonEventSource } from "./fetch-json-event-source";

function installFetchEventSourceBrowserGlobals() {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

  Object.defineProperties(globalThis, {
    document: {
      configurable: true,
      value: {
        hidden: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    },
    window: {
      configurable: true,
      value: {
        clearTimeout: globalThis.clearTimeout,
        setTimeout: globalThis.setTimeout,
      },
    },
  });

  return () => {
    if (documentDescriptor) {
      Object.defineProperty(globalThis, "document", documentDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }

    if (windowDescriptor) {
      Object.defineProperty(globalThis, "window", windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  };
}

function eventStreamResponse(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}

function splitInsideCharacter(value: string, character: string): Uint8Array[] {
  const encoder = new TextEncoder();
  const characterStart = encoder.encode(value.slice(0, value.indexOf(character))).length;
  const encoded = encoder.encode(value);
  return [encoded.slice(0, characterStart + 1), encoded.slice(characterStart + 1)];
}

describe("fetchJsonEventSource", () => {
  let restoreBrowserGlobals: () => void;

  beforeEach(() => {
    restoreBrowserGlobals = installFetchEventSourceBrowserGlobals();
  });

  afterEach(() => {
    restoreBrowserGlobals();
  });
  it("parses a CRLF-delimited multiline SSE payload split inside a UTF-8 character", async () => {
    const received: Array<{ event: string; data: Record<string, unknown>; id: string }> = [];
    const frame = [
      "id: event-1\r\n",
      "event: progress\r\n",
      'data: {"message":\r\n',
      'data: "你好", "count": 1}\r\n',
      "\r\n",
    ].join("");

    await fetchJsonEventSource("https://chrona.test/events", {
      fetch: (async (_input: RequestInfo | URL, _init?: RequestInit) => eventStreamResponse(splitInsideCharacter(frame, "你"))) as typeof fetch,
      onEvent: ({ event, data, message }) => received.push({ event, data, id: message.id }),
    });

    expect(received).toEqual([
      { event: "progress", data: { message: "你好", count: 1 }, id: "event-1" },
    ]);
  });

  it("sends malformed and non-object JSON payloads to the invalid-message handler", async () => {
    const invalid: string[] = [];
    const received: Record<string, unknown>[] = [];
    const encoder = new TextEncoder();
    const frame = [
      "event: update\n",
      "data: {not-json}\n\n",
      "event: update\n",
      "data: [1, 2]\n\n",
      "event: update\n",
      "data: null\n\n",
    ].join("");

    await fetchJsonEventSource("https://chrona.test/events", {
      fetch: (async (_input: RequestInfo | URL, _init?: RequestInit) => eventStreamResponse([encoder.encode(frame)])) as typeof fetch,
      onEvent: ({ data }) => received.push(data),
      onInvalidMessage: (message) => invalid.push(message.data),
    });

    expect(received).toEqual([]);
    expect(invalid).toEqual(["{not-json}", "[1, 2]", "null"]);
  });

  it("resolves on caller abort without retrying the stream", async () => {
    const controller = new AbortController();
    let calls = 0;
    let closeStream: (() => void) | undefined;
    const pendingResponse = new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          closeStream = () => streamController.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );

    const completed = fetchJsonEventSource("https://chrona.test/events", {
      signal: controller.signal,
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        init?.signal?.addEventListener("abort", () => closeStream?.(), { once: true });
        return pendingResponse;
      }) as typeof fetch,
      onEvent: () => undefined,
    });

    await Promise.resolve();
    controller.abort();
    await completed;

    expect(calls).toBe(1);
  });
});

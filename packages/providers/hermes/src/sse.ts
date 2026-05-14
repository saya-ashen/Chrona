export async function* parseSseData(stream: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      yield* drainSseBuffer(buffer, (remaining) => {
        buffer = remaining;
      });
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      yield parseSseBlock(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}

function* drainSseBuffer(
  buffer: string,
  setRemaining: (remaining: string) => void,
): Iterable<unknown> {
  let cursor = 0;
  while (true) {
    const next = buffer.indexOf("\n\n", cursor);
    if (next === -1) {
      setRemaining(buffer.slice(cursor));
      return;
    }

    const block = buffer.slice(cursor, next);
    cursor = next + 2;
    const parsed = parseSseBlock(block);
    if (parsed !== undefined) {
      yield parsed;
    }
  }
}

function parseSseBlock(block: string): unknown {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith(":"))
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return undefined;
  }

  const data = dataLines.join("\n");
  if (data === "[DONE]") {
    return undefined;
  }

  return JSON.parse(data);
}

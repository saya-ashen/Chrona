import { parseJsonServerEventStream } from "@chrona/providers-foundation";

/** Parse provider SSE using the shared server-side framing and UTF-8 contract. */
export async function* parseSseData(stream: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  yield* parseJsonServerEventStream(stream, { doneSentinel: "[DONE]" });
}

import { codingError } from "./storage";

// Reserve space for SDK stdout metadata as well as both SDK/routed result wrappers.
export const MAX_CODING_OUTPUT_BYTES = 230 * 1024;
export const MAX_ARTIFACT_BYTES = 96 * 1024;
export const encodedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
export function boundedCodingOutput<T>(value: T): T {
  if (encodedBytes({ result: { result: value } }) + 4096 > MAX_CODING_OUTPUT_BYTES) throw codingError("too_large", "Coding response exceeds 230 KiB encoded output budget; request a smaller page");
  return value;
}

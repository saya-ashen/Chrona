import { createHash } from "node:crypto";

/**
 * Chrona's versioned canonical JSON form. Arrays retain their semantic order;
 * object keys use deterministic Unicode code-unit ordering.
 */
export function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, nested]) => [key, stableJsonValue(nested)]),
  );
}

/** Produces canonical JSON without whitespace or process-dependent key ordering. */
export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

/** Hashes canonical JSON using the persisted runtime hash representation. */
export function stableJsonHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJsonStringify(value)).digest("hex")}`;
}

/** Makes an independent, recursively immutable persisted contract snapshot. */
export function freezeCanonical<T>(value: T): T {
  const clone = JSON.parse(stableJsonStringify(value)) as T;

  const freeze = (candidate: unknown): unknown => {
    if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) return candidate;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    return Object.freeze(candidate);
  };

  return freeze(clone) as T;
}

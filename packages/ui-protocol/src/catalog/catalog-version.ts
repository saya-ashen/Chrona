/**
 * Catalog compatibility version. Bump the major when a change to the component
 * set or props schemas is breaking. Every UiDocument carries the version it was
 * produced against; the renderer falls back to typed rendering on a major
 * mismatch (see plan §4.3).
 */
export const CATALOG_VERSION = "1.0.0";

function major(version: string): string {
  return version.split(".")[0] ?? "";
}

/** True when a document produced against `documentVersion` is safe to render. */
export function isCatalogCompatible(
  documentVersion: string,
  rendererVersion: string = CATALOG_VERSION,
): boolean {
  return major(documentVersion) === major(rendererVersion) && major(documentVersion) !== "";
}

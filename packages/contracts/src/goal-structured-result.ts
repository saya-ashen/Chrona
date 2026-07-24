import type { UiDocument } from "@chrona/ui-protocol";

export const STRUCTURED_RESULT_FORMAT = "chrona-json-render" as const;
export const STRUCTURED_RESULT_SCHEMA_VERSION = 1 as const;

export type StructuredResultArtifactRef = {
  ref: string;
  title: string;
  mimeType: string | null;
  size: number | null;
  checksum: string | null;
};

export type StructuredResultAssetContent = {
  format: typeof STRUCTURED_RESULT_FORMAT;
  schemaVersion: typeof STRUCTURED_RESULT_SCHEMA_VERSION;
  catalogVersion: string;
  summary: string;
  spec: UiDocument;
  artifactRefs: StructuredResultArtifactRef[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function isArtifactRef(value: unknown): value is StructuredResultArtifactRef {
  const artifact = record(value);
  return Boolean(
    artifact &&
    typeof artifact.ref === "string" && /^GF[0-9A-F]{12}$/.test(artifact.ref) &&
    typeof artifact.title === "string" &&
    (artifact.mimeType === null || typeof artifact.mimeType === "string") &&
    (artifact.size === null || typeof artifact.size === "number") &&
    (artifact.checksum === null || typeof artifact.checksum === "string"),
  );
}


export function isStructuredResultAssetContent(
  value: unknown,
): value is StructuredResultAssetContent {
  const content = record(value);
  const spec = record(content?.spec);
  return (
    content?.format === STRUCTURED_RESULT_FORMAT &&
    content.schemaVersion === STRUCTURED_RESULT_SCHEMA_VERSION &&
    typeof content.catalogVersion === "string" &&
    typeof content.summary === "string" &&
    typeof spec?.root === "string" &&
    record(spec.elements) !== null &&
    Array.isArray(content.artifactRefs) &&
    content.artifactRefs.every(isArtifactRef)
  );
}

export function stringProp(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function recordProp(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringField(value: unknown, field: string) {
  return stringProp(recordProp(value)?.[field]);
}

export function boolProp(value: unknown) {
  return value === true;
}

export function formatFileSize(bytes: unknown) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function filePreviewErrorMessage(
  error: unknown,
  copy: Record<string, string | undefined>,
) {
  if (error === "unsafe_path")
    return copy.filePreviewUnsafePath ?? "Preview is unavailable for this path.";
  if (error === "not_found")
    return copy.filePreviewNotFound ?? "File was not found.";
  if (error === "unsupported_type")
    return copy.filePreviewUnsupported ?? "This file type cannot be previewed.";
  if (error === "read_failed")
    return copy.filePreviewReadFailed ?? "File preview could not be loaded.";
  return null;
}

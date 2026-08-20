import { realpath } from "node:fs/promises";
import { extname, isAbsolute, resolve, sep } from "node:path";
import { getChronaGeneratedFilesDir } from "@chrona/shared/data-paths";
import type { UiDocument } from "@chrona/ui-protocol";
import { resolveGeneratedFileReference } from "./result-file-access";

const DEFAULT_PREVIEW_BYTES = 64 * 1024;
const ALLOWED_EXTENSIONS: ReadonlyMap<string, FilePreviewKind> = new Map([
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".txt", "text"],
  [".json", "json"],
  [".csv", "csv"],
]);
const DENIED_SEGMENT_PATTERN =
  /(^\.env$|secret|secrets|token|tokens|credential|credentials|keychain)/i;

export type FilePreviewError =
  | "permission_required"
  | "unsafe_path"
  | "not_found"
  | "unsupported_type"
  | "read_failed";
export type FilePreviewKind = "markdown" | "json" | "text" | "csv";

export type FilePreview = {
  displayPath?: string;
  contentKind?: FilePreviewKind;
  contentPreview?: string;
  contentTruncated?: boolean;
  contentBytes?: number;
  previewError?: FilePreviewError;
};

export type FilePreviewOptions = {
  rootDir?: string;
  maxPreviewBytes?: number;
  allowedAbsolutePath?: string;
  taskId?: string;
};

function normalizeDisplayPath(uri: string) {
  return uri.replace(/\\/g, "/");
}

function isDeniedPath(uri: string) {
  return normalizeDisplayPath(uri)
    .split("/")
    .some((segment) => DENIED_SEGMENT_PATTERN.test(segment));
}

function safeRelativePath(uri: string) {
  if (
    !uri.trim() ||
    isAbsolute(uri) ||
    uri.includes("://") ||
    isDeniedPath(uri)
  )
    return null;
  const normalized = normalizeDisplayPath(uri);
  if (normalized.split("/").includes("..")) return null;
  return normalized;
}

function isWithinRoot(root: string, candidate: string) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function previewKindForPath(uri: string): FilePreviewKind | null {
  return ALLOWED_EXTENSIONS.get(extname(uri).toLowerCase()) ?? null;
}

async function formatPreviewText(kind: FilePreviewKind, text: string) {
  if (kind !== "json") return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export async function resolveFilePreview(
  uri: string | undefined,
  options: FilePreviewOptions = {},
): Promise<FilePreview> {
  if (!uri) return { previewError: "unsafe_path" };
  const generatedPath = resolveGeneratedFileReference(uri);
  const allowedAbsolutePath = options.allowedAbsolutePath
    ? resolve(options.allowedAbsolutePath)
    : null;
  const relativePath = safeRelativePath(uri);
  const explicitRoot = options.rootDir ? resolve(options.rootDir) : null;
  const rootDir = explicitRoot ?? resolve(getChronaGeneratedFilesDir());
  const resolvedPath =
    generatedPath ??
    (allowedAbsolutePath
      ? allowedAbsolutePath
      : explicitRoot && relativePath
        ? resolve(explicitRoot, relativePath)
        : null);
  const displayPath =
    generatedPath ?? allowedAbsolutePath ?? relativePath ?? uri;
  if (!resolvedPath) {
    return {
      displayPath: uri,
      previewError: isDeniedPath(uri) ? "unsafe_path" : "permission_required",
    };
  }
  if (
    !generatedPath &&
    !allowedAbsolutePath &&
    !isWithinRoot(rootDir, resolvedPath)
  ) {
    return { displayPath, previewError: "permission_required" };
  }

  const kind = previewKindForPath(resolvedPath);
  if (!kind) return { displayPath, previewError: "unsupported_type" };

  const file = Bun.file(resolvedPath);
  if (!(await file.exists()))
    return { displayPath, contentKind: kind, previewError: "not_found" };

  try {
    const realFile = await realpath(resolvedPath);
    if (!allowedAbsolutePath) {
      const realRoot = await realpath(rootDir);
      if (!isWithinRoot(realRoot, realFile))
        return { displayPath, previewError: "unsafe_path" };
    }
    const contentBytes = file.size;
    const maxPreviewBytes = options.maxPreviewBytes ?? DEFAULT_PREVIEW_BYTES;
    const contentTruncated = contentBytes > maxPreviewBytes;
    const blob = contentTruncated ? file.slice(0, maxPreviewBytes) : file;
    const rawPreview = await blob.text();
    return {
      displayPath,
      contentKind: kind,
      contentPreview: await formatPreviewText(kind, rawPreview),
      contentBytes,
      contentTruncated,
    };
  } catch {
    return { displayPath, contentKind: kind, previewError: "read_failed" };
  }
}

function fileUriFromProps(props: unknown) {
  if (!props || typeof props !== "object") return undefined;
  const record = props as Record<string, unknown>;
  return typeof record.uri === "string"
    ? record.uri
    : typeof record.path === "string"
      ? record.path
      : undefined;
}

function resultFileDownloadHref(taskId: string, uri: string) {
  return `/api/tasks/${encodeURIComponent(taskId)}/result-files/download?path=${encodeURIComponent(uri)}`;
}

export async function hydrateFilePreviewSpec(
  spec: UiDocument,
  options: FilePreviewOptions = {},
): Promise<UiDocument> {
  const elements = { ...spec.elements };
  for (const [key, element] of Object.entries(spec.elements)) {
    if (
      element.type !== "FileView" &&
      element.type !== "FileRef" &&
      element.type !== "ResultDeliverable" &&
      element.type !== "WorkspaceArtifactItem" &&
      element.type !== "Table"
    )
      continue;
    const uri = fileUriFromProps(element.props);
    const preview = await resolveFilePreview(uri, options);
    elements[key] = {
      ...element,
      props: {
        ...element.props,
        ...preview,
        ...(uri?.startsWith("generated://") && options.taskId
          ? { downloadHref: resultFileDownloadHref(options.taskId, uri) }
          : {}),
        ...(preview.previewError === "permission_required" && options.taskId
          ? {
              accessTaskId: options.taskId,
              accessRequestedPath: uri,
            }
          : {}),
      },
    };
  }

  return { ...spec, elements };
}

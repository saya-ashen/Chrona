import { realpath } from "node:fs/promises";
import { extname, isAbsolute, resolve, sep } from "node:path";
import type { UiDocument } from "@chrona/ui-protocol";

const DEFAULT_PREVIEW_BYTES = 64 * 1024;
const ALLOWED_EXTENSIONS: ReadonlyMap<string, FilePreviewKind> = new Map([
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".txt", "text"],
  [".json", "json"],
  [".csv", "csv"],
]);
const DENIED_SEGMENT_PATTERN = /(^\.env$|secret|secrets|token|tokens|credential|credentials|keychain)/i;

export type FilePreviewError = "unsafe_path" | "not_found" | "unsupported_type" | "read_failed";
export type FilePreviewKind = "markdown" | "json" | "text" | "csv";

export type FilePreview = {
  displayPath?: string;
  contentKind?: FilePreviewKind;
  contentPreview?: string;
  contentTruncated?: boolean;
  contentBytes?: number;
  previewError?: FilePreviewError;
};

type FilePreviewOptions = {
  rootDir?: string;
  maxPreviewBytes?: number;
};

function normalizeDisplayPath(uri: string) {
  return uri.replace(/\\/g, "/");
}

function isDeniedPath(uri: string) {
  return normalizeDisplayPath(uri).split("/").some((segment) => DENIED_SEGMENT_PATTERN.test(segment));
}

function safeRelativePath(uri: string) {
  if (!uri.trim() || isAbsolute(uri) || uri.includes("://") || isDeniedPath(uri)) return null;
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

export async function resolveFilePreview(uri: string | undefined, options: FilePreviewOptions = {}): Promise<FilePreview> {
  if (!uri) return { previewError: "unsafe_path" };
  const relativePath = safeRelativePath(uri);
  if (!relativePath) return { displayPath: uri, previewError: "unsafe_path" };

  const kind = previewKindForPath(relativePath);
  if (!kind) return { displayPath: relativePath, previewError: "unsupported_type" };

  const rootDir = resolve(options.rootDir ?? process.cwd());
  const resolvedPath = resolve(rootDir, relativePath);
  if (!isWithinRoot(rootDir, resolvedPath)) return { displayPath: relativePath, previewError: "unsafe_path" };

  const file = Bun.file(resolvedPath);
  if (!(await file.exists())) return { displayPath: relativePath, contentKind: kind, previewError: "not_found" };

  try {
    const realRoot = await realpath(rootDir);
    const realFile = await realpath(resolvedPath);
    if (!isWithinRoot(realRoot, realFile)) return { displayPath: relativePath, previewError: "unsafe_path" };

    const contentBytes = file.size;
    const maxPreviewBytes = options.maxPreviewBytes ?? DEFAULT_PREVIEW_BYTES;
    const contentTruncated = contentBytes > maxPreviewBytes;
    const blob = contentTruncated ? file.slice(0, maxPreviewBytes) : file;
    const rawPreview = await blob.text();
    return {
      displayPath: relativePath,
      contentKind: kind,
      contentPreview: await formatPreviewText(kind, rawPreview),
      contentBytes,
      contentTruncated,
    };
  } catch {
    return { displayPath: relativePath, contentKind: kind, previewError: "read_failed" };
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

export async function hydrateFilePreviewSpec(spec: UiDocument, options: FilePreviewOptions = {}): Promise<UiDocument> {
  const elements = { ...spec.elements };
  for (const [key, element] of Object.entries(spec.elements)) {
    if (element.type !== "FileView" && element.type !== "FileRef" && element.type !== "WorkspaceArtifactItem") continue;
    const preview = await resolveFilePreview(fileUriFromProps(element.props), options);
    elements[key] = {
      ...element,
      props: {
        ...element.props,
        ...preview,
      },
    };
  }

  return { ...spec, elements };
}

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import type { UiDocument } from "@chrona/ui-protocol";
import { db } from "@/lib/db";
import { generatedFilesRoot, resolveGeneratedFileReference } from "../../tasks/result-file-access";

const PREVIEW_BYTES = 64 * 1024;
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".csv"]);
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
};

type GeneratedFileReference = {
  uri: string;
  title: string;
  sourceNodeId: string | null;
};

function generatedFileReferences(spec: UiDocument): GeneratedFileReference[] {
  const references = new Map<string, GeneratedFileReference>();
  for (const element of Object.values(spec.elements)) {
    if (element.type !== "FileRef" && element.type !== "FileView") continue;
    const props = element.props as Record<string, unknown>;
    const uri = typeof props.path === "string" ? props.path : null;
    if (!uri?.startsWith("generated://")) continue;
    references.set(uri, {
      uri,
      title: typeof props.title === "string" && props.title.trim() ? props.title.trim() : basename(uri),
      sourceNodeId: typeof props.xChronaSourceNodeId === "string" ? props.xChronaSourceNodeId : null,
    });
  }
  return [...references.values()];
}

function isWithinGeneratedRoot(path: string) {
  const root = resolve(generatedFilesRoot());
  return path === root || path.startsWith(`${root}${sep}`);
}

async function inspectGeneratedFile(reference: GeneratedFileReference) {
  const resolved = resolveGeneratedFileReference(reference.uri);
  if (!resolved) return null;
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(resolved);
  } catch {
    return null;
  }
  if (!isWithinGeneratedRoot(canonicalPath)) return null;
  const fileStat = await stat(canonicalPath);
  if (!fileStat.isFile()) return null;
  const content = await readFile(canonicalPath);
  const extension = extname(canonicalPath).toLowerCase();
  return {
    ...reference,
    checksum: createHash("sha256").update(content).digest("hex"),
    size: fileStat.size,
    mimeType: MIME_TYPES[extension] ?? "application/octet-stream",
    contentPreview: TEXT_EXTENSIONS.has(extension)
      ? content.subarray(0, PREVIEW_BYTES).toString("utf8")
      : null,
  };
}

export async function registerGeneratedPlanOutputArtifacts(input: {
  workspaceId: string;
  taskId: string;
  runId: string | null | undefined;
  spec: UiDocument | null;
}) {
  if (!input.runId || !input.spec) return 0;
  const run = await db.run.findFirst({
    where: { id: input.runId, taskId: input.taskId },
    select: { id: true, occurrenceId: true },
  });
  if (!run) return 0;

  const inspected = (await Promise.all(generatedFileReferences(input.spec).map(inspectGeneratedFile)))
    .filter((file): file is NonNullable<typeof file> => file !== null);
  for (const file of inspected) {
    const metadata = {
      checksumAlgorithm: "sha256",
      checksum: file.checksum,
      size: file.size,
      mimeType: file.mimeType,
      sourceNodeId: file.sourceNodeId,
    };
    const existing = await db.artifact.findFirst({
      where: { taskId: input.taskId, runId: input.runId, uri: file.uri },
      select: { id: true },
    });
    if (existing) {
      await db.artifact.update({
        where: { id: existing.id },
        data: { title: file.title, contentPreview: file.contentPreview, metadata },
      });
    } else {
      await db.artifact.create({
        data: {
          workspaceId: input.workspaceId,
          taskId: input.taskId,
          runId: input.runId,
          occurrenceId: run.occurrenceId,
          type: "file",
          title: file.title,
          uri: file.uri,
          contentPreview: file.contentPreview,
          metadata,
        },
      });
    }
  }
  return inspected.length;
}

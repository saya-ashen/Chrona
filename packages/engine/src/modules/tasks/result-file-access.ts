import { lstat, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname, isAbsolute, resolve, sep } from "node:path";
import { getChronaGeneratedFilesDir } from "@chrona/shared/data-paths";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

const GRANT_TTL_MS = 5 * 60 * 1000;
const MAX_GRANTS = 256;
const DENIED_ROOTS = ["/proc", "/sys", "/dev"] as const;
const DENIED_SEGMENT_PATTERN =
  /(^\.env(?:\..*)?$|secret|secrets|token|tokens|credential|credentials|keychain|\.ssh|\.gnupg)/i;
const DENIED_EXTENSION_PATTERN = /\.(?:key|pem|p12|pfx)$/i;

type ResultFileGrant = {
  id: string;
  taskId: string;
  requestedPath: string;
  canonicalPath: string;
  device: bigint;
  inode: bigint;
  size: number;
  modifiedAtMs: number;
  createdAt: number;
  expiresAt: number;
};

const grants = new Map<string, ResultFileGrant>();

function isWithinRoot(root: string, candidate: string) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function isSensitivePath(candidate: string) {
  const normalized = candidate.replaceAll("\\", "/");
  if (
    DENIED_ROOTS.some(
      (root) => normalized === root || normalized.startsWith(`${root}/`),
    )
  ) {
    return true;
  }
  if (DENIED_EXTENSION_PATTERN.test(normalized)) return true;
  return normalized
    .split("/")
    .some((segment) => DENIED_SEGMENT_PATTERN.test(segment));
}

function pruneGrants() {
  const now = Date.now();
  for (const [id, grant] of grants) {
    if (grant.expiresAt <= now) grants.delete(id);
  }
  if (grants.size <= MAX_GRANTS) return;
  const oldest = [...grants.values()].sort(
    (left, right) => left.createdAt - right.createdAt,
  );
  for (const grant of oldest.slice(0, grants.size - MAX_GRANTS))
    grants.delete(grant.id);
}

async function canonicalFile(requestedPath: string) {
  const absolutePath = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(process.cwd(), requestedPath);
  if (isSensitivePath(absolutePath)) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "This sensitive path cannot be opened from task results",
    );
  }

  let directStat;
  try {
    directStat = await lstat(absolutePath, { bigint: true });
  } catch {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "File was not found",
    );
  }
  if (directStat.isSymbolicLink()) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Symbolic links cannot be opened from task results",
    );
  }
  if (!directStat.isFile()) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "Only regular files can be opened from task results",
    );
  }

  const canonicalPath = await realpath(absolutePath);
  if (isSensitivePath(canonicalPath)) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "This sensitive path cannot be opened from task results",
    );
  }
  const stat = await lstat(canonicalPath, { bigint: true });
  return { canonicalPath, stat };
}

export function generatedFilesRoot() {
  return resolve(getChronaGeneratedFilesDir());
}

export function generatedFileReference(scope: string, filename: string) {
  return `generated://${scope}/${filename}`;
}

export function resolveGeneratedFileReference(uri: string) {
  if (!uri.startsWith("generated://")) return null;
  const relative = uri.slice("generated://".length).replaceAll("\\", "/");
  if (
    !relative ||
    relative
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  const root = generatedFilesRoot();
  const candidate = resolve(root, relative);
  return isWithinRoot(root, candidate) ? candidate : null;
}

export async function requestResultFileAccess(input: {
  taskId: string;
  requestedPath: string;
}) {
  pruneGrants();
  const { canonicalPath, stat } = await canonicalFile(input.requestedPath);
  const generatedRoot = generatedFilesRoot();
  if (isWithinRoot(generatedRoot, canonicalPath)) {
    return {
      status: "already_allowed" as const,
      requestedPath: input.requestedPath,
      canonicalPath,
    };
  }

  const id = randomUUID();
  const now = Date.now();
  const grant: ResultFileGrant = {
    id,
    taskId: input.taskId,
    requestedPath: input.requestedPath,
    canonicalPath,
    device: stat.dev,
    inode: stat.ino,
    size: Number(stat.size),
    modifiedAtMs: Number(stat.mtimeMs),
    createdAt: now,
    expiresAt: now + GRANT_TTL_MS,
  };
  grants.set(id, grant);
  return {
    status: "permission_required" as const,
    requestId: id,
    requestedPath: grant.requestedPath,
    canonicalPath: grant.canonicalPath,
    filename: basename(grant.canonicalPath),
    extension: extname(grant.canonicalPath).toLowerCase(),
    size: grant.size,
    expiresAt: new Date(grant.expiresAt).toISOString(),
  };
}

export async function approveResultFileAccess(input: {
  taskId: string;
  requestId: string;
}) {
  pruneGrants();
  const grant = grants.get(input.requestId);
  if (!grant || grant.taskId !== input.taskId) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      "File access request expired or was not found",
    );
  }

  const { canonicalPath, stat } = await canonicalFile(grant.canonicalPath);
  if (
    canonicalPath !== grant.canonicalPath ||
    stat.dev !== grant.device ||
    stat.ino !== grant.inode ||
    Number(stat.size) !== grant.size ||
    Number(stat.mtimeMs) !== grant.modifiedAtMs
  ) {
    grants.delete(grant.id);
    throw new EngineError(
      ENGINE_ERROR_CODES.CONFLICT,
      "File changed after access was requested. Request access again.",
    );
  }

  grants.delete(grant.id);
  return {
    requestedPath: grant.requestedPath,
    canonicalPath: grant.canonicalPath,
  };
}

export function __resetResultFileAccessGrantsForTests() {
  grants.clear();
}

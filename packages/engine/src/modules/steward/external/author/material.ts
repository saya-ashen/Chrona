import { createHash } from "node:crypto";
import { isAbsolute, normalize } from "node:path";
import { AuthorError, fail, object, relative, sourceDir, submitDir, text } from "./contracts";
export type MaterialFile = { path: string; bytes: Buffer; executable?: boolean };

export const MATERIAL_RECORD = "chrona-material.json";
export const MATERIAL_LIMITS = { fileBytes: 64 * 1024 * 1024, totalBytes: 257 * 1024 * 1024, artifactBytes: 256 * 1024 * 1024, files: 1200, entries: 4000, recordBytes: 1024 * 1024 } as const;
export const SOURCE_LIMITS = { fileBytes: 64 * 1024, totalBytes: 1024 * 1024, files: 200, entries: 400, outputBytes: 16384, readCharacters: 2000 } as const;
export type Build = { commands: string[]; toolchain: string; target: string };
export type Artifact = { path: string; executable?: boolean };
export type MaterialRecord = { schema: 1; source: string[]; artifacts: (Artifact & { sha256: string })[]; build: Build };
export type ImportMaterial = { from: string; to: string; source: string[]; artifacts: Artifact[]; build: Build; overwrite?: boolean };
export type ExportMaterial = { path: string; to: string; overwrite?: boolean };
export const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export function workspaceDirectory(value: unknown): string {
  const path = text(value, 4096);
  if (!isAbsolute(path) || normalize(path) !== path || path === "/" || path.includes("\\") || Array.from(path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return fail("Expected an explicit normalized absolute workspace directory.");
  return path;
}
function pathEntries(paths: string[]) {
  const files = new Set(paths), entries = new Set<string>();
  if (files.size !== paths.length) return fail("Duplicate material paths.");
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      if (i < parts.length && files.has(prefix)) return fail("Material file paths must not overlap.");
      entries.add(prefix);
    }
  }
  return entries.size;
}
function materialPath(value: unknown) {
  const path = relative(value);
  if (path.length > 1024 || ["node_modules", ".venv", ".chrona"].includes(path.split("/")[0]!)) return fail("Expected a bounded material path outside installed dependencies.");
  return path;
}
function selection(source: unknown, artifacts: unknown, recorded: boolean) {
  if (!Array.isArray(source) || !source.length || source.length >= SOURCE_LIMITS.files || !Array.isArray(artifacts) || artifacts.length > 1000 || source.length + artifacts.length + 1 > MATERIAL_LIMITS.files) return fail("Expected bounded explicit source and artifact file selections.");
  const sources = source.map(materialPath);
  if (!sources.includes("module.json")) return fail("Select module.json as source.");
  const outputs = artifacts.map(value => {
    const row = object(value, recorded ? ["path", "sha256", "executable"] : ["path", "executable"], recorded ? ["path", "sha256"] : ["path"]);
    if (row.executable !== undefined && typeof row.executable !== "boolean") return fail("Expected a boolean executable flag.");
    if (recorded && (typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256))) return fail("Expected an artifact SHA-256 digest.");
    return { path: materialPath(row.path), ...(row.executable === undefined ? {} : { executable: row.executable }), ...(recorded ? { sha256: row.sha256 as string } : {}) };
  });
  const paths = [...sources, ...outputs.map(file => file.path), MATERIAL_RECORD];
  if (pathEntries(paths) > MATERIAL_LIMITS.entries || pathEntries(sources) > SOURCE_LIMITS.entries) throw new AuthorError("too_large", "Selected paths exceed the source or material entry limit.");
  return { source: sources, artifacts: outputs };
}
function build(value: unknown): Build {
  const row = object(value, ["commands", "toolchain", "target"]);
  if (!Array.isArray(row.commands) || row.commands.length > 100) return fail("Expected bounded build command notes.");
  return { commands: row.commands.map(command => text(command, 8192)), toolchain: text(row.toolchain, 4096), target: text(row.target, 1024) };
}
export function parseImport(value: unknown): ImportMaterial {
  const row = object(value, ["from", "to", "source", "artifacts", "build", "overwrite"], ["from", "to", "source", "artifacts", "build"]);
  const overwrite = row.overwrite === undefined ? undefined : typeof row.overwrite === "boolean" ? row.overwrite : fail("Expected a boolean overwrite flag.");
  return { from: workspaceDirectory(row.from), to: sourceDir(row.to), ...selection(row.source, row.artifacts, false), build: build(row.build), ...(overwrite === undefined ? {} : { overwrite }) };
}
export function parseExport(value: unknown): ExportMaterial {
  const row = object(value, ["path", "to", "overwrite"], ["path", "to"]);
  const overwrite = row.overwrite === undefined ? undefined : typeof row.overwrite === "boolean" ? row.overwrite : fail("Expected a boolean overwrite flag.");
  return { path: submitDir(row.path), to: workspaceDirectory(row.to), ...(overwrite === undefined ? {} : { overwrite }) };
}
export function parseMaterialRecord(bytes: Buffer): MaterialRecord {
  if (bytes.length > MATERIAL_LIMITS.recordBytes) throw new AuthorError("too_large", "Material record exceeds 1 MiB.");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return fail("Material record must be UTF-8 JSON."); }
  const row = object(value, ["schema", "source", "artifacts", "build"]);
  if (row.schema !== 1) return fail("Expected material record schema 1.");
  return { schema: 1, ...selection(row.source, row.artifacts, true), build: build(row.build) } as MaterialRecord;
}
/** Validate full snapshots, including the record's actual bytes/modes and exact membership. */
export function validateMaterial(files: MaterialFile[]) {
  const recordFile = files.find(file => file.path === MATERIAL_RECORD);
  const record = recordFile ? parseMaterialRecord(recordFile.bytes) : undefined;
  const limit = record ? MATERIAL_LIMITS : SOURCE_LIMITS;
  if (!files.length || files.length > limit.files) throw new AuthorError("too_large", "Material exceeds the file count limit.");
  const paths = files.map(file => materialPath(file.path));
  if (pathEntries(paths) > limit.entries) throw new AuthorError("too_large", "Material exceeds the entry limit.");
  const sources = new Set(record?.source ?? paths);
  const artifacts = new Map(record?.artifacts.map(file => [file.path, file]));
  let total = 0, sourceBytes = 0, artifactBytes = 0;
  for (const file of files) {
    const artifact = artifacts.get(file.path);
    const source = sources.has(file.path);
    const max = source ? (record ? SOURCE_LIMITS.totalBytes : SOURCE_LIMITS.fileBytes) : file.path === MATERIAL_RECORD ? MATERIAL_LIMITS.recordBytes : MATERIAL_LIMITS.fileBytes;
    if (record && !source && !artifact && file.path !== MATERIAL_RECORD) return fail("Material contains a file outside its record.");
    total += file.bytes.length;
    if (source || file.path === MATERIAL_RECORD) sourceBytes += file.bytes.length;
    if (artifact) artifactBytes += file.bytes.length;
    if (file.bytes.length > max || total > limit.totalBytes || sourceBytes > SOURCE_LIMITS.totalBytes || artifactBytes > MATERIAL_LIMITS.artifactBytes) throw new AuthorError("too_large", "Material exceeds source or artifact byte limits.");
    if (artifact && (digest(file.bytes) !== artifact.sha256 || Boolean(file.executable) !== Boolean(artifact.executable))) throw new AuthorError("conflict", "Artifact bytes or executable mode differ from the material record.");
  }
  if (record && files.length !== record.source.length + record.artifacts.length + 1) return fail("Material record names missing files.");
  return { bytes: total, record };
}
export function materialSummary(files: MaterialFile[]) {
  // The stage proof and kernel receipt must identify the same frozen bytes.
  const hash = createHash("sha256"), explicit = files.some(file => file.path === MATERIAL_RECORD);
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path).update("\0");
    if (explicit) hash.update(`${file.executable ? "755" : "644"}:${file.bytes.length}:`);
    hash.update(file.bytes).update("\0");
  }
  return { files: files.length, bytes: files.reduce((total, file) => total + file.bytes.length, 0), materialDigest: hash.digest("hex") };
}

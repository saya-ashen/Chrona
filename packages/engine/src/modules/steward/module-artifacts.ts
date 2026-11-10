import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { MODULE_MATERIAL_FILE, MODULE_SOURCE_MAX_BYTES, MODULE_SOURCE_MAX_FILES, MODULE_ARTIFACT_MAX_BYTES, MODULE_ARTIFACT_MAX_FILE_BYTES, moduleMaterialSchema, type ModuleMaterial } from "../../../../contracts/src/steward/module-material";
import { ModuleSnapshot, openModuleDirectory, snapshotModule, type ModuleFile } from "./module-files";
import { StewardError } from "./errors";

const sorted = (files: ModuleFile[]) => [...files].sort((a, b) => a.path.localeCompare(b.path));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function moduleMaterialRecord(files: ModuleFile[]): ModuleMaterial | null {
  const file = files.find(file => file.path === MODULE_MATERIAL_FILE);
  if (!file) return null;
  if (file.bytes.byteLength > MODULE_SOURCE_MAX_BYTES) throw new StewardError("invalid", "Material record exceeds source limits");
  try { return moduleMaterialSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes))); }
  catch { throw new StewardError("invalid", "Invalid chrona-material.json"); }
}
function assertSources(files: ModuleFile[], record: ModuleMaterial) {
  const paths = new Set(files.map(file => file.path));
  if (paths.size !== files.length || files.length !== record.source.length + 1 || !paths.has(MODULE_MATERIAL_FILE) || !record.source.every(path => paths.has(path))) throw new StewardError("invalid", "Git source does not match its material record");
  if (files.length > MODULE_SOURCE_MAX_FILES || files.reduce((total, file) => total + file.bytes.byteLength, 0) > MODULE_SOURCE_MAX_BYTES) throw new StewardError("invalid", "Module exceeds source file limits");
}
export function validateModuleSourceRecord(files: ModuleFile[]) {
  const record = moduleMaterialRecord(files);
  if (record) assertSources(files, record);
}
/** Returns exactly the bytes that belong in Git, verifying the entire submitted material. */
export function moduleSourceFiles(files: ModuleFile[]): ModuleFile[] {
  const record = moduleMaterialRecord(files);
  if (!record) return files;
  const source = files.filter(file => file.path === MODULE_MATERIAL_FILE || record.source.includes(file.path));
  assertSources(source, record);
  if (new Set(files.map(file => file.path)).size !== files.length || files.length !== source.length + record.artifacts.length) throw new StewardError("invalid", "Unexpected or duplicate material files");
  let total = 0;
  for (const artifact of record.artifacts) {
    const file = files.find(file => file.path === artifact.path);
    if (!file) throw new StewardError("invalid", "Declared artifact is missing");
    total += file.bytes.byteLength;
    if (file.bytes.byteLength > MODULE_ARTIFACT_MAX_FILE_BYTES || total > MODULE_ARTIFACT_MAX_BYTES) throw new StewardError("invalid", "Module exceeds artifact file limits");
    if (sha256(file.bytes) !== artifact.sha256 || !!file.executable !== !!artifact.executable) throw new StewardError("conflict", "Artifact digest or executable mode does not match its material record");
  }
  return sorted(source);
}
/** Explicit materials include ignored source/build inputs and bounded binary artifacts. */
export async function snapshotModuleMaterial(root: string, path: string, options: { verifyTree?: boolean } = {}): Promise<ModuleFile[]> {
  const snapshot = new ModuleSnapshot();
  try {
    const directory = await openModuleDirectory(root, path, false, snapshot);
    let recordFile: ModuleFile;
    try { recordFile = await directory.read(MODULE_MATERIAL_FILE, MODULE_SOURCE_MAX_BYTES); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return snapshotModule(root, path); throw error; }
    const record = moduleMaterialRecord([recordFile])!;
    const files = [recordFile];
    let sourceTotal = recordFile.bytes.byteLength, artifactTotal = 0;
    for (const path of record.source) {
      const file = await directory.read(path, MODULE_SOURCE_MAX_BYTES - sourceTotal);
      sourceTotal += file.bytes.byteLength;
      files.push(file);
    }
    for (const artifact of record.artifacts) {
      const file = await directory.read(artifact.path, Math.min(MODULE_ARTIFACT_MAX_FILE_BYTES, MODULE_ARTIFACT_MAX_BYTES - artifactTotal));
      artifactTotal += file.bytes.byteLength;
      files.push(file);
    }
    if (options.verifyTree) await directory.verifyTree(new Set(files.map(file => file.path)));
    await snapshot.verify();
    moduleSourceFiles(files);
    return sorted(files);
  } finally { await snapshot.close(); }
}
/** A CAS winner must be a complete, ordinary object, without unbound side files. */
async function readArtifact(directory: Awaited<ReturnType<typeof openModuleDirectory>>, digest: string, limit: number) {
  const object = await directory.directory(digest);
  try {
    const file = await object.read("bytes", limit), entries = await object.entries();
    if (entries.length !== 1 || entries[0]?.name !== "bytes" || file.executable || sha256(file.bytes) !== digest) throw new StewardError("conflict", "Stored artifact digest or object layout mismatch; object preserved");
    return file;
  } finally { await object.close(); }
}
/** Store only verified bytes. Existing objects are verified, never repaired or overwritten. */
export async function storeModuleArtifacts(platform: string, files: ModuleFile[]): Promise<ModuleFile[]> {
  const source = moduleSourceFiles(files), record = moduleMaterialRecord(source);
  if (!record?.artifacts.length) return source;
  await mkdir(platform, { recursive: true });
  const directory = await openModuleDirectory(platform, "artifacts/sha256", true);
  try {
    for (const artifact of record.artifacts) {
      const file = files.find(file => file.path === artifact.path)!;
      // An existing corrupt or unsafe object must fail without changing it.
      let existing: ModuleFile | undefined;
      try { existing = await readArtifact(directory, artifact.sha256, MODULE_ARTIFACT_MAX_FILE_BYTES); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (!existing) {
        await directory.publishImmutable(artifact.sha256, file.bytes);
        existing = await readArtifact(directory, artifact.sha256, MODULE_ARTIFACT_MAX_FILE_BYTES);
      }
    }
  } finally { await directory.close(); }
  return source;
}
/** Reconstruct exact version material; never run build commands or use a mutable output. */
export async function restoreModuleArtifacts(platform: string, source: ModuleFile[]): Promise<ModuleFile[]> {
  const record = moduleMaterialRecord(source);
  if (!record) return source;
  assertSources(source, record);
  const files = [...source];
  if (record.artifacts.length) {
    const directory = await openModuleDirectory(platform, "artifacts/sha256");
    let total = 0;
    try {
      for (const artifact of record.artifacts) {
        const file = await readArtifact(directory, artifact.sha256, Math.min(MODULE_ARTIFACT_MAX_FILE_BYTES, MODULE_ARTIFACT_MAX_BYTES - total));
        total += file.bytes.byteLength;
        files.push({ path: artifact.path, bytes: file.bytes, ...(artifact.executable ? { executable: true } : {}) });
      }
    } finally { await directory.close(); }
  }
  return sorted(files);
}
/** Length-delimited, mode-bound material digest; legacy receipts retain their original digest. */
export function moduleMaterialDigest(files: ModuleFile[]) {
  const digest = createHash("sha256"), explicit = !!moduleMaterialRecord(files);
  for (const file of sorted(files)) {
    digest.update(file.path).update("\0");
    if (explicit) digest.update(`${file.executable ? "755" : "644"}:${file.bytes.byteLength}:`);
    digest.update(file.bytes).update("\0");
  }
  return digest.digest("hex");
}

import { createHash } from "node:crypto";
import { z } from "zod";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { MODULE_MATERIAL_FILE, MODULE_SOURCE_MAX_BYTES, MODULE_SOURCE_MAX_FILES, MODULE_ARTIFACT_MAX_BYTES, MODULE_ARTIFACT_MAX_FILE_BYTES, isModuleMaterialPath, moduleMaterialSchema, type ModuleMaterial } from "../../../contracts/src/steward/module-material";
import { ModuleSnapshot, openModuleDirectory, openOptionalModuleDirectory, sweepModuleDirectories, type ModuleDirectory, type ModuleFile } from "./module-files";
import { StewardError } from "../errors";

const sorted = (files: ModuleFile[]) => [...files].sort((a, b) => a.path.localeCompare(b.path));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function moduleMaterialRecord(files: ModuleFile[]): ModuleMaterial | null {
  const file = files.find(file => file.path === MODULE_MATERIAL_FILE);
  if (!file) return null;
  if (file.bytes.byteLength > MODULE_SOURCE_MAX_BYTES) throw new StewardError("invalid", "Material record exceeds source limits");
  try { return moduleMaterialSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes))); }
  catch (error) { throw Object.assign(new StewardError("invalid", "Invalid chrona-material.json"), { cause: error }); }
}
function assertSources(files: ModuleFile[], record: ModuleMaterial) {
  const paths = new Set(files.map(file => file.path));
  if (paths.size !== files.length || files.length !== record.source.length + 1 || !paths.has(MODULE_MATERIAL_FILE) || !record.source.every(path => paths.has(path))) throw new StewardError("invalid", "Source does not match its material record");
  if (files.length > MODULE_SOURCE_MAX_FILES || files.reduce((total, file) => total + file.bytes.byteLength, 0) > MODULE_SOURCE_MAX_BYTES) throw new StewardError("invalid", "Module exceeds source file limits");
}
/** Source includes the exact record and build inputs; artifacts are verified separately. */
export function moduleSourceFiles(files: ModuleFile[]): ModuleFile[] {
  const record = moduleMaterialRecord(files);
  if (!record) throw new StewardError("invalid", "chrona-material.json is required");
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
    catch (error) { throw Object.assign(new StewardError("invalid", "chrona-material.json is required and must be readable"), { cause: error }); }
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
  if (!record) throw new StewardError("invalid", "chrona-material.json is required");
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
/** Version identity binds every selected path, byte length, byte and executable mode. */
export function moduleMaterialDigest(files: ModuleFile[]) {
  const digest = createHash("sha256");
  for (const file of sorted(files)) {
    digest.update(file.path).update("\0");
    digest.update(`${file.executable ? "755" : "644"}:${file.bytes.byteLength}:`);
    digest.update(file.bytes).update("\0");
  }
  return digest.digest("hex");
}

const storedSourceSchema = z.array(z.object({
  path: z.string().refine(isModuleMaterialPath),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  executable: z.boolean(),
}).strict()).min(1).max(MODULE_SOURCE_MAX_FILES);

export async function storeVersionMaterial(platform: string, files: ModuleFile[]): Promise<string> {
  const source = await storeModuleArtifacts(platform, files), hash = moduleMaterialDigest(files);
  await mkdir(platform, { recursive: true });
  const objects = await openModuleDirectory(platform, "artifacts/sha256", true);
  try {
    for (const file of source) {
      const digest = sha256(file.bytes);
      await objects.publishImmutable(digest, file.bytes);
      await readArtifact(objects, digest, MODULE_SOURCE_MAX_BYTES);
    }
  } finally { await objects.close(); }
  const index = source.map(file => ({ path: file.path, sha256: sha256(file.bytes), executable: !!file.executable }));
  const materials = await openModuleDirectory(platform, "materials/sha256", true);
  try { await materials.publishImmutable(hash, Buffer.from(JSON.stringify(index))); }
  finally { await materials.close(); }
  await readStoredVersionMaterial(platform, hash);
  return hash;
}

async function readMaterialIndex(materials: ModuleDirectory) {
  const entries = await materials.entries(), file = await materials.read("bytes", MODULE_SOURCE_MAX_BYTES);
  if (entries.length !== 1 || entries[0]?.name !== "bytes" || file.executable) throw new StewardError("conflict", "Stored material index layout mismatch; object preserved");
  return storedSourceSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
}

export async function readStoredVersionMaterial(platform: string, hash: string): Promise<ModuleFile[]> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new StewardError("invalid", "Invalid material SHA256 identity");
  const materials = await openModuleDirectory(platform, `materials/sha256/${hash}`);
  const index = await readMaterialIndex(materials).finally(() => materials.close());
  const objects = await openModuleDirectory(platform, "artifacts/sha256"), source: ModuleFile[] = [];
  let total = 0;
  try {
    for (const entry of index) {
      const file = await readArtifact(objects, entry.sha256, MODULE_SOURCE_MAX_BYTES - total);
      total += file.bytes.byteLength;
      source.push({ path: entry.path, bytes: file.bytes, ...(entry.executable ? { executable: true } : {}) });
    }
  } finally { await objects.close(); }
  const files = await restoreModuleArtifacts(platform, source);
  if (moduleMaterialDigest(files) !== hash) throw new StewardError("conflict", "Stored material differs from its SHA256 identity; objects preserved");
  return files;
}

const materialOperations = new Map<string, Promise<unknown>>();

export async function withMaterialPublication<T>(platform: string, operation: () => Promise<T>): Promise<T> {
  const key = resolve(platform);
  const pending = materialOperations.get(key);
  const result = pending ? pending.then(operation, operation) : Promise.resolve().then(operation);
  materialOperations.set(key, result);
  try { return await result; }
  finally { if (materialOperations.get(key) === result) materialOperations.delete(key); }
}

export async function collectMaterialObjects(platform: string, versions: Set<string>) {
  const indexesRemoved = await sweepModuleDirectories(platform, "materials/sha256", versions);
  const objects = await openOptionalModuleDirectory(platform, "artifacts/sha256");
  if (!objects) return { indexesRemoved, objectsRemoved: 0 };
  try {
    const keep = new Set<string>();
    for (const hash of versions) {
      if (!/^[a-f0-9]{64}$/.test(hash)) continue;
      const files = await readStoredVersionMaterial(platform, hash).catch(error => {
        throw new Error(`Cannot verify retained material ${hash}: ${String(error)}`, { cause: error });
      });
      for (const file of files) keep.add(sha256(file.bytes));
    }
    return { indexesRemoved, objectsRemoved: await objects.sweepDigests(keep) };
  } finally { await objects.close(); }
}

import { createHash } from "node:crypto";
import { AuthorError, fail, name, relative, type Stage } from "./contracts";
import { SOURCE_LIMITS, type MaterialFile, type SourceFiles } from "./files";
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
function packageEntry(expectedName: string, files: MaterialFile[]): string {
  const manifestFile = files.find(file => file.path === "module.json");
  if (!manifestFile) return fail("Package is missing module.json.");
  let manifest: unknown;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestFile.bytes)); }
  catch { return fail("Package manifest must be UTF-8 JSON."); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !("name" in manifest) || manifest.name !== expectedName) return fail("Package manifest name does not match the selected target.");
  return relative("entry" in manifest ? manifest.entry : undefined);
}

/** Pure material preparation for later CLI reuse. Metadata is a local claim, never admission evidence. */
export function packageMaterial(expectedName: string, material: MaterialFile[], provenance: Stage["provenance"]) {
  name(expectedName);
  if (!material.length || material.length > SOURCE_LIMITS.files) throw new AuthorError("too_large", "Package needs one to 200 files.");
  const files = material.map(file => ({ path: relative(file.path), bytes: Buffer.from(file.bytes) })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (new Set(files.map(file => file.path)).size !== files.length) return fail("Duplicate package paths.");
  let bytes = 0;
  for (const file of files) {
    bytes += file.bytes.length;
    if (file.bytes.length > SOURCE_LIMITS.fileBytes || bytes > SOURCE_LIMITS.totalBytes) throw new AuthorError("too_large", "Package exceeds source byte limits.");
  }
  const entry = packageEntry(expectedName, files);
  if (!files.some(file => file.path === entry)) return fail("Package entry must be present in its source tree.");
  // This is intentionally not kernel manifest validation or a claim that the package passes checks.
  const index = files.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: digest(file.bytes) }));
  const materialDigest = digest(JSON.stringify(index));
  const metadata = { schema: 1, name: expectedName, provenanceAuthority: "caller-declared", provenance, materialDigest, bytes, files: index };
  const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;
  if (Buffer.byteLength(metadataText) > SOURCE_LIMITS.fileBytes) throw new AuthorError("too_large", "Package provenance exceeds 64 KiB.");
  return { files, metadata, metadataText };
}
export async function stagePackage(files: SourceFiles, input: Stage) {
  const material = packageMaterial(input.name, await files.snapshot(input.from), input.provenance);
  await files.stage(input.to, material.files, material.metadataText);
  return { name: input.name, dir: `${input.to}/source`, metadata: `${input.to}/provenance.json`, files: material.files.length, bytes: material.metadata.bytes, materialDigest: material.metadata.materialDigest };
}

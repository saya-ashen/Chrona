import { AuthorError, fail, name, object, relative, type Stage } from "./contracts";
import { type MaterialFile, type SourceFiles } from "./files";
import { digest, MATERIAL_LIMITS, validateMaterial } from "./material";
function packageEntry(expectedName: string, files: MaterialFile[]): string {
  const manifestFile = files.find(file => file.path === "module.json");
  if (!manifestFile) return fail("Package is missing module.json.");
  let manifest: unknown;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestFile.bytes)); }
  catch { return fail("Package manifest must be UTF-8 JSON."); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !("name" in manifest) || manifest.name !== expectedName) return fail("Package manifest name does not match the selected target.");
  const entry = "entry" in manifest ? manifest.entry : undefined;
  // Entry arguments and host runtime declarations are checked by the kernel.
  return relative(typeof entry === "string" ? entry : object(entry, ["path", "args", "runtime"], ["path"]).path);
}

/** Pure material preparation for later CLI reuse. Metadata is a local claim, never admission evidence. */
export function packageMaterial(expectedName: string, material: MaterialFile[], provenance: Stage["provenance"]) {
  name(expectedName);
  const { bytes } = validateMaterial(material);
  const files = material.map(file => ({ path: relative(file.path), bytes: Buffer.from(file.bytes), executable: Boolean(file.executable) })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const entry = packageEntry(expectedName, files);
  if (!files.some(file => file.path === entry)) return fail("Package entry must be present in its source tree.");
  // This is intentionally not kernel manifest validation or a claim that the package passes checks.
  const index = files.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: digest(file.bytes), executable: file.executable }));
  const materialDigest = digest(JSON.stringify(index));
  const metadata = { schema: 1, name: expectedName, provenanceAuthority: "caller-declared", provenance, materialDigest, bytes, files: index };
  const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;
  if (Buffer.byteLength(metadataText) > MATERIAL_LIMITS.recordBytes) throw new AuthorError("too_large", "Package provenance exceeds 1 MiB.");
  return { files, metadata, metadataText };
}
export async function stagePackage(files: SourceFiles, input: Stage) {
  const material = packageMaterial(input.name, await files.snapshot(input.from), input.provenance);
  await files.stage(input.to, material.files, material.metadataText);
  return { name: input.name, dir: `${input.to}/source`, metadata: `${input.to}/provenance.json`, files: material.files.length, bytes: material.metadata.bytes, materialDigest: material.metadata.materialDigest };
}

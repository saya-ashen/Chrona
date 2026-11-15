import { AuthorError, fail, name, relative, type Stage } from "./contracts";
import { type MaterialFile, type SourceFiles } from "./files";
import { digest, MATERIAL_LIMITS, validateMaterial, materialSummary } from "./material";
import { checkMaterial } from "./validate";

/** Pure material preparation for later CLI reuse. Metadata is a local claim, never admission evidence. */
export function packageMaterial(expectedName: string, material: MaterialFile[], provenance: Stage["provenance"]) {
  name(expectedName);
  const { bytes } = validateMaterial(material);
  const files = material.map(file => ({ path: relative(file.path), bytes: Buffer.from(file.bytes), executable: Boolean(file.executable) })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const { checks } = checkMaterial(files, expectedName);
  const failures = checks.filter(check => !check.ok);
  if (failures.length) return fail(failures.map(check => `${check.name}: ${check.detail}`).join("\n"));
  const index = files.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: digest(file.bytes), executable: file.executable }));
  const materialDigest = materialSummary(files).materialDigest;
  const metadata = { schema: 1, name: expectedName, provenanceAuthority: "caller-declared", provenance, materialDigest, bytes, files: index };
  const metadataText = `${JSON.stringify(metadata, null, 2)}\n`;
  if (Buffer.byteLength(metadataText) > MATERIAL_LIMITS.recordBytes) throw new AuthorError("too_large", "Package provenance exceeds 1 MiB.");
  return { files, metadata, metadataText, checks };
}
export async function stagePackage(files: SourceFiles, input: Stage) {
  const material = packageMaterial(input.name, await files.snapshot(input.from), input.provenance);
  await files.stage(input.to, material.files, material.metadataText);
  return { name: input.name, dir: `${input.to}/source`, metadata: `${input.to}/provenance.json`, files: material.files.length, bytes: material.metadata.bytes, materialDigest: material.metadata.materialDigest, checks: material.checks };
}

import { z } from "zod";

export const MODULE_MATERIAL_FILE = "chrona-material.json";
export const MODULE_SOURCE_MAX_FILES = 200;
export const MODULE_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
const MODULE_ARTIFACT_MAX_FILES = 1000;
export const MODULE_ARTIFACT_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MODULE_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;

/** Portable, relative file names; installed dependency trees are never submitted. */
export function isModuleMaterialPath(path: string): boolean {
  const parts = path.split("/");
  return path.length <= 1024 && !path.includes("\\") && !Array.from(path).some(char => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127) && !parts.some(part => !part || part === "." || part === ".." || part === ".git" || part.includes(":"))
    && !["node_modules", ".venv", ".chrona"].includes(parts[0]!);
}
const moduleMaterialPathSchema = z.string().refine(isModuleMaterialPath, "Invalid module material path");
const moduleArtifactSchema = z.object({
  path: moduleMaterialPathSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  executable: z.boolean().optional(),
}).strict();
/** Build provenance describes the submitted bytes; it is not proof of reproducibility. */
export const moduleMaterialSchema = z.object({
  schema: z.literal(1),
  source: z.array(moduleMaterialPathSchema).min(1).max(MODULE_SOURCE_MAX_FILES - 1),
  artifacts: z.array(moduleArtifactSchema).max(MODULE_ARTIFACT_MAX_FILES),
  build: z.object({ commands: z.array(z.string().min(1).max(8192)).max(100), toolchain: z.string().min(1).max(4096), target: z.string().min(1).max(1024) }).strict(),
}).strict().superRefine((record, context) => {
  const paths = [MODULE_MATERIAL_FILE, ...record.source, ...record.artifacts.map(artifact => artifact.path)].sort();
  if (!record.source.includes("module.json")) context.addIssue({ code: "custom", message: "source must include module.json", path: ["source"] });
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path) || path.split("/").slice(0, -1).some((_, index, parts) => seen.has(parts.slice(0, index + 1).join("/")))) {
      context.addIssue({ code: "custom", message: "Material paths must be unique, disjoint files", path: ["source"] });
      break;
    }
    seen.add(path);
  }
});
/** Shared by material consumers while runtime entry validation lives in the manifest contract. */
export function moduleMaterialEntryPath(entry: string | { path: string }): string { return typeof entry === "string" ? entry : entry.path; }
export type ModuleMaterial = z.infer<typeof moduleMaterialSchema>;
export function parseModuleMaterial(value: unknown): ModuleMaterial { return moduleMaterialSchema.parse(value); }

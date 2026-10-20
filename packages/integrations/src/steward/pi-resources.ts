import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { z } from "zod";
const name = z.string().regex(/^[\w:.-]{1,100}$/);
export const piResourcesSchema = z.object({
  skills: z.array(z.string().min(1).max(2000)).max(30).default([]),
  extensions: z.array(z.string().min(1).max(2000)).max(20).default([]),
  tools: z.array(name).max(100).default([]),
}).strict();
export type PiResources = z.infer<typeof piResourcesSchema>;
const builtins = new Set(["builtin:mcp", "builtin:codemode", "builtin:tool-search"]);
const empty = (): PiResources => ({ skills: [], extensions: [], tools: [] });
function within(parent: string, file: string) { const path = relative(parent, file); return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path); }
function entry(path: string, roots: string[]) {
  if (!isAbsolute(path) || realpathSync(path) !== path || roots.some(root => within(root, path))) throw new Error("Unsafe Pi resource path");
  const stat = statSync(path);
  if (!stat.isFile() || process.platform !== "win32" && (stat.mode & 0o022) !== 0) throw new Error("Unsafe Pi resource file");
}
/** Read an owner-chosen manifest, not model text or Pi's ambient package/skill settings. */
export function readPiResources(file: string | undefined, profile: string, workspace?: string): { resources: PiResources; error: string | null } {
  if (file === undefined) return { resources: empty(), error: null };
  try {
    const roots = [profile, workspace].filter((root): root is string => !!root && isAbsolute(root));
    entry(file, roots);
    if (process.platform !== "win32" && (statSync(file).mode & 0o077) !== 0 || statSync(file).size > 32_000) throw new Error("Manifest must be private and bounded");
    const resources = piResourcesSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    for (const skill of resources.skills) { entry(skill, roots); if (!skill.endsWith(".md")) throw new Error("Skill must be an explicit Markdown file"); }
    for (const extension of resources.extensions) if (!builtins.has(extension)) entry(extension, roots);
    return { resources: { skills: [...new Set(resources.skills)], extensions: [...new Set(resources.extensions)], tools: [...new Set(resources.tools)] }, error: null };
  } catch { return { resources: empty(), error: "Pi resource manifest must be a private canonical JSON file with reviewed external entry files" }; }
}
export function resourceVersionError(resources: PiResources, version: string, sandboxed: boolean): string | null {
  if (resources.extensions.some(value => builtins.has(value)) && version !== "1.3.0") return "Native Pi builtins require the explicit 1.3.0 pin";
  if (!sandboxed && (resources.tools.some(tool => tool === "bash" || tool === "codemode") || resources.extensions.includes("builtin:codemode"))) return "Pi code execution resources require bubblewrap";
  return null;
}
export function resourceCommand(resources: PiResources, source: unknown, path: unknown, baseExtensions: string[]): boolean {
  if (typeof path !== "string") return false;
  if (source === "extension" && builtins.has(path)) return resources.extensions.includes(path);
  try {
    if (!isAbsolute(path)) return false;
    const candidates = source === "extension" ? [...baseExtensions, ...resources.extensions.filter(value => !builtins.has(value))] : source === "skill" ? resources.skills : [];
    const canonical = realpathSync(path);
    return candidates.some(candidate => realpathSync(candidate) === canonical);
  } catch { return false; }
}

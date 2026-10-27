import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { z } from "zod";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import { listSystemModules, type SystemTool } from "./module-calls";
import { checkoutModule } from "./module-files";
import { readModuleFiles } from "./module-preview";
import { StewardError } from "./errors";

export const BUILD_MODULE_TOOLS = ["m_modules_propose", "m_modules_check", "m_modules_checkout", "m_modules_reference", "m_modules_request_group"];

/** Appended at claim time, including continuations created before these tools existed. */
export const BUILD_REFERENCE_PROMPT = `Development references: m_modules_reference is available in this build. Call it without target to discover interface names, then with {target:"<module>.<tool>"} for the exact input schema, admission rules and declared output schema/examples. This reads metadata only; it never executes the target or returns business data. A null outputSchema means undeclared: do not invent fields from an empty response. For a built-in app, m_modules_checkout {module,source:"builtin",dir:<fresh directory>} retrieves the reference shipped with this running release, even if customization kept it out of the version store. Compare it with a fresh default checkout of the active custom version; merge the requested feature, never replace customization. Built-in and stored hashes are distinct provenance, not approval. If a required reference is unavailable, report the exact target/file to the originating conversation for supplementation and manual continuation; do not expand permissions, fabricate a contract or start paid retries.`;

type Reference = { target: string; source: { kind: "system" | "module"; hash: string | null }; tool: SystemTool };
async function references(ports: StewardPorts, workspaceId: string): Promise<Reference[]> {
  const found: Reference[] = listSystemModules().flatMap(module => module.tools.map(tool => ({ target: `${module.name}.${tool.name}`, source: { kind: "system" as const, hash: null }, tool })));
  const modules = await ports.db.module.findMany({ where: { workspaceId, status: "active", activeHash: { not: null } }, orderBy: { name: "asc" } });
  for (const module of modules) {
    const version = await ports.db.moduleVersion.findUnique({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
    const manifest = moduleManifestSchema.safeParse(version?.manifest);
    if (!manifest.success) continue;
    for (const tool of manifest.data.tools) found.push({ target: `${module.name}.${tool.name}`, source: { kind: "module", hash: module.activeHash }, tool });
  }
  return found;
}

/** Code metadata only: never call a handler, inspect settings, read incidents or start a module. */
export async function interfaceReference(ports: StewardPorts, workspaceId: string, target?: string) {
  const entries = await references(ports, workspaceId);
  if (!target) return entries.map(({ target, source, tool }) => ({ target, source, description: tool.description }));
  const entry = entries.find(entry => entry.target === target);
  if (!entry) throw new StewardError("not_found", "Interface reference not found");
  const { tool, source } = entry;
  const contract = {
    target, source, description: tool.description,
    inputSchema: tool.input ? z.toJSONSchema(tool.input) : { ...tool.parameters, additionalProperties: false },
    outputSchema: tool.output ? z.toJSONSchema(tool.output) : null,
    documentation: tool.documentation ?? null, examples: tool.examples ?? [],
    admission: { visibility: tool.visibility, callers: tool.callers ?? null, uses: target, idempotent: tool.idempotent },
    routingErrors: ["forbidden", "not_found", "conflict", "cycle", "invalid", "unknown", "failed", "unavailable"],
  };
  return { ...contract, contractHash: createHash("sha256").update(JSON.stringify(contract)).digest("hex") };
}

/** Only the running release's trusted resources; no fallback to an old registered built-in. */
export async function checkoutBuiltinReference(ports: StewardPorts, name: string, dir: string, cwd: string) {
  const module = moduleManifestSchema.shape.name.parse(name);
  if (!ports.moduleBuiltinResources) throw new StewardError("not_found", "Built-in release resources are not configured");
  const root = await realpath(ports.moduleBuiltinResources), path = join(root, module);
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new StewardError("not_found", "Built-in release reference not found");
    throw error;
  });
  if (!info.isDirectory() || info.isSymbolicLink() || !(await realpath(path)).startsWith(root + sep)) throw new StewardError("forbidden", "Unsafe built-in reference");
  const files = (await readModuleFiles(path, "Unsafe built-in reference file")).sort((a, b) => a.path.localeCompare(b.path));
  const manifest = files.find(file => file.path === "module.json");
  if (!manifest || moduleManifestSchema.parse(JSON.parse(manifest.bytes.toString("utf8"))).name !== module) throw new StewardError("invalid", "Built-in reference manifest mismatch");
  const digest = createHash("sha256");
  for (const file of files) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  await checkoutModule(cwd, dir, files);
  return { module, source: "builtin", hash: digest.digest("hex"), dir };
}

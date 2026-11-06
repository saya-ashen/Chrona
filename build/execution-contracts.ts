import { access, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { codingToolDeclarations, moduleManifestSchema, type ModuleManifest } from "@chrona/contracts/steward";
import { executionContractDeclarations, executorContractDeclarations } from "./execution-contract-types";

/** Single source for H's manifest tools; caller supplies the rest of its real product manifest. */
export function codingPackageManifest(manifest: ModuleManifest): ModuleManifest {
  const productTools = manifest.tools.filter(tool => ["work", "workspace-cleanup", "reconcile"].includes(tool.name));
  return { ...manifest, tools: [...codingToolDeclarations(), ...productTools] };
}

/** Build into existing package roots only: absent products stay unavailable in the catalog. */
export async function buildExecutionContracts(externalRoot: string, entry = resolve(import.meta.dirname, "../packages/contracts/src/steward/execution-tools.ts")) {
  const built: string[] = [];
  for (const name of ["coding", "editor"] as const) {
    const dir = join(externalRoot, name), manifestPath = join(dir, "module.json");
    try { await access(manifestPath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    if (manifest.name !== name) throw new Error(`Unexpected execution package name: ${manifest.name}`);
    const result = await Bun.build({ entrypoints: [entry], target: "bun", outdir: dir, naming: "contract.js" });
    if (!result.success) throw new AggregateError(result.logs, `Could not build ${name} contract`);
    await writeFile(join(dir, "contract.d.ts"), executionContractDeclarations());
    const executor = await Bun.build({ entrypoints: [resolve(import.meta.dirname, "../packages/contracts/src/steward/executor.ts")], target: "bun", outdir: dir, naming: "executor-contract.js" });
    if (!executor.success) throw new AggregateError(executor.logs, `Could not build ${name} executor contract`);
    await writeFile(join(dir, "executor-contract.d.ts"), executorContractDeclarations());
    if (name === "coding") await writeFile(manifestPath, JSON.stringify(codingPackageManifest(manifest), null, 2) + "\n");
    built.push(name);
  }
  return built;
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root) throw new Error("Usage: bun build/execution-contracts.ts <external-packages-root>");
  console.log(JSON.stringify({ built: await buildExecutionContracts(resolve(root)) }));
}

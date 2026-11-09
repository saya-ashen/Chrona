import { access, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { executionContractDeclarations, executorContractDeclarations } from "./execution-contract-types";

/** Build private schemas for Coding without changing its command manifest. */
export async function buildExecutionContracts(externalRoot: string, entry = resolve(import.meta.dirname, "../packages/contracts/src/steward/execution-tools.ts")) {
  const dir = join(externalRoot, "coding"), manifestPath = join(dir, "module.json");
  try { await access(manifestPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const manifest = moduleManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (manifest.name !== "coding") throw new Error(`Unexpected execution package name: ${manifest.name}`);
  const result = await Bun.build({ entrypoints: [entry], target: "bun", outdir: dir, naming: "contract.js" });
  if (!result.success) throw new AggregateError(result.logs, "Could not build coding contract");
  await writeFile(join(dir, "contract.d.ts"), executionContractDeclarations());
  const executor = await Bun.build({ entrypoints: [resolve(import.meta.dirname, "../packages/contracts/src/steward/executor.ts")], target: "bun", outdir: dir, naming: "executor-contract.js" });
  if (!executor.success) throw new AggregateError(executor.logs, "Could not build coding executor contract");
  await writeFile(join(dir, "executor-contract.d.ts"), executorContractDeclarations());
  return ["coding"];
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root) throw new Error("Usage: bun build/execution-contracts.ts <external-packages-root>");
  console.log(JSON.stringify({ built: await buildExecutionContracts(resolve(root)) }));
}

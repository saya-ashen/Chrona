import { moduleToolContract } from "./module-tool-contract";
import type { StewardPorts } from "../ports";
import { references } from "./module-reference";
import type { ModuleManifest } from "@chrona/contracts/steward";

import type { ModuleCallContracts } from "./module-contract-types";
export type { ModuleCallContracts, ModuleRuntimes } from "./module-contract-types";

/** Every module-callable target, using the same contracts as discovery and routing. */
export async function callsContracts(ports: StewardPorts, workspaceId: string, candidate?: { moduleName: string; manifest: ModuleManifest }): Promise<ModuleCallContracts> {
  let entries = await references(ports, workspaceId);
  if (candidate) {
    const prefix = `${candidate.moduleName}.`;
    entries = entries.filter(entry => !(entry.source.kind === "module" && entry.target.startsWith(prefix)));
    entries.push(...candidate.manifest.tools.map(tool => ({ target: `${candidate.moduleName}.${tool.name}`, source: { kind: "module" as const, hash: null }, tool })));
  }
  return Object.fromEntries(entries
    .filter(({ tool }) => tool.visibility.some(who => who === "modules" || who === "owner"))
    .map(({ target, source, tool }) => {
      const contract = moduleToolContract(tool);
      return [target, { input: source.kind === "module" ? tool.parameters : contract.input, output: contract.output }];
    }));
}

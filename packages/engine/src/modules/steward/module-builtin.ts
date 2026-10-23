import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { StewardPorts } from "./ports";
import { moduleContext } from "./module-context";
import { proposeBuiltin } from "./module-proposal";
import { buildPending } from "./module-build";

/** Release resources, never Provider-controlled directories. Repeated starts are idempotent. */
export async function registerBuiltins(ports: StewardPorts, workspaceId: string) {
  if (!ports.moduleBuiltinResources) return;
  const root = resolve(ports.moduleBuiltinResources);
  const context = moduleContext(ports, workspaceId);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const result = await proposeBuiltin(context, root, entry.name);
    if (result.status === "rejected") throw new Error(`Built-in ${entry.name} rejected: ${JSON.stringify(result.report)}`);
  }
  await buildPending(context);
}

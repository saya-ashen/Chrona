import type { StewardPorts } from "./ports";

/** Kernel capabilities need no application seed. Optional preinstalls use the ordinary installation ledger. */
export async function registerBuiltins(_ports: StewardPorts, _workspaceId: string): Promise<void> {}

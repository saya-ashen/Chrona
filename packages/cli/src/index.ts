#!/usr/bin/env bun

import { createProgram, dispatchNodeCommand } from "./program.js";

export { createProgram, dispatchNodeCommand };

async function main(argv: string[]): Promise<void> {
  // Skill-mode control subtree (`chrona node <verb>`, `chrona task read`,
  // `chrona plan read`) goes directly to the agent-cli library. The reason:
  // the verb is a free-form positional that doesn't fit Commander's strict
  // subcommand schema.
  const slice = argv.slice(2);
  if (slice.length > 0 && (slice[0] === "node" || slice[0] === "task" || slice[0] === "plan")) {
    const result = await dispatchNodeCommand(slice);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.code);
  }
  await createProgram().parseAsync(argv);
}

await main(process.argv);

#!/usr/bin/env bun

import { Command } from "commander";
import { registerTaskCommands } from "./commands/task.js";
import { registerRunCommands } from "./commands/run.js";
import { registerScheduleCommands } from "./commands/schedule.js";
import { registerAiCommands } from "./commands/ai.js";
import { createClientOptions, createClientResolver } from "./commands/shared.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("chrona")
    .description("Chrona CLI: thin command-line client for the Chrona app API.")
    .version("0.2.0");

  createClientOptions(program);

  const resolveClient = createClientResolver(program);

  registerTaskCommands(program, resolveClient);
  registerRunCommands(program, resolveClient);
  registerScheduleCommands(program, resolveClient);
  registerAiCommands(program, resolveClient);

  return program;
}

async function main(argv: string[]): Promise<void> {
  await createProgram().parseAsync(argv);
}

await main(process.argv);

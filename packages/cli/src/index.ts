#!/usr/bin/env bun

import { createProgram } from "./program.js";

export { createProgram };

async function main(argv: string[]): Promise<void> {
  await createProgram().parseAsync(argv);
}

await main(process.argv);

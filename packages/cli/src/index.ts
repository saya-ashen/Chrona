#!/usr/bin/env bun
import { createProgram } from "./program.js";
export { createProgram };
await createProgram().parseAsync(process.argv);

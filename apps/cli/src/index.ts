#!/usr/bin/env bun
import { createProgram } from "./program.js";

await createProgram().parseAsync(process.argv);

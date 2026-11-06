#!/usr/bin/env bun
import { dispatchExecutorProcess } from "./executor-entry";
if (!await dispatchExecutorProcess(process.argv.slice(2))) {
  const { createProgram } = await import("./program.js");
  await createProgram().parseAsync(process.argv);
}

import { chrona, ModelError, on } from "chrona";
import { AuthorError } from "./contracts";
import { createSourceFiles } from "./files";
import { authorTool } from "./workflow";
const context = { files: createSourceFiles(chrona.paths.content), call: (target: string, args: Record<string, unknown>) => chrona.call(target, args) };
on("tool", async event => {
  try { return { result: await authorTool(context, event.id, event.args, event.caller) }; }
  catch (error) {
    if (error instanceof AuthorError) throw new ModelError(error.code, error.message);
    throw error;
  }
});

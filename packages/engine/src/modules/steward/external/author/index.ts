import { chrona, ModelError, on } from "chrona";
import { AuthorError } from "./contracts";
import { createSourceFiles } from "./files";
import { authorTool } from "./workflow";
const context = { files: createSourceFiles(chrona.paths.content, [chrona.paths.data, chrona.paths.module]), call: (target: string, args: Record<string, unknown>) => chrona.call(target, args) };
on("tool", async event => {
  try { return { result: await authorTool(context, event.id, event.args, event.caller) }; }
  catch (error) {
    if (error instanceof AuthorError) {
      // Application-only codes are not SDK wire codes. An invalid error reply is
      // discarded by the channel and leaves the caller waiting for its deadline.
      const code = error.code === "unsafe_source" ? "invalid" : error.code === "source_io" ? "failed" : error.code;
      throw new ModelError(code, error.message);
    }
    throw error;
  }
});

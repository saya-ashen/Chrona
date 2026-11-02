import { on, chrona } from "chrona";
import { createFiles } from "./files";
import { PAGE } from "./page";

const files = createFiles(chrona.paths.content, chrona.paths.data);
on("tool", async (event: { id: string; args: Record<string, unknown>; now: string }) => ({ result: await files.tool(event.id, event.args, event.now) }));
// Register the documents page with web; a web without pages is not a fault: Chrona tells this module again when web changes.
on("activated", async () => {
  try { await chrona.call("web.page-set", PAGE); }
  catch (error) { console.error(JSON.stringify({ level: "warn", message: "web page not registered", error: String(error) })); }
  return {};
});

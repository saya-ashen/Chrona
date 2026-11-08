import { on, chrona } from "chrona";
import { createFiles } from "./files";
import { PAGE } from "./page";

const files = createFiles(chrona.paths.content, chrona.paths.data);
on("tool", async (event: { id: string; args: Record<string, unknown>; now: string }) => ({ result: await files.tool(event.id, event.args, event.now) }));
// Register the documents page with web; a web without pages is not a fault: Chrona tells this module again when web changes.
on("activated", async () => {
  const registration = await chrona.call("web.page-set", PAGE);
  if (registration && typeof registration === "object" && "error" in registration) throw new Error(`Page registration failed: ${String(registration.error)}`);
  return {};
});

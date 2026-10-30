import { on, chrona } from "chrona";
import { createFiles } from "./files";

const files = createFiles(chrona.paths.content, chrona.paths.data);
on("tool", async (event: { id: string; args: Record<string, unknown>; now: string }) => ({ result: await files.tool(event.id, event.args, event.now) }));

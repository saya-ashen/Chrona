// @ts-expect-error Chrona supplies the SDK at this at run time.
import { on, chrona } from "chrona";
import { createFiles } from "./files";

const files = createFiles(chrona.paths.content, chrona.paths.data);
on("content_edit", async (event: { paths: string[]; now: string }) => { await files.contentEdit(event.paths, event.now); });
on("tool", async (event: { id: string; args: Record<string, unknown>; now: string }) => ({ result: await files.tool(event.id, event.args, event.now) }));

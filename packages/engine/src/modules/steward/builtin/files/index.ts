// @ts-expect-error Chrona supplies the SDK at this sandbox-only path.
import { on } from "/chrona/sdk.ts";
import { createFiles } from "./files";

const files = createFiles();
on("content_edit", async (event: { paths: string[]; now: string }) => { await files.contentEdit(event.paths, event.now); });
on("tool", async (event: { id: string; args: Record<string, unknown>; now: string }) => ({ result: await files.tool(event.id, event.args, event.now) }));

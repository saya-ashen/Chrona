import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildApplicationUI } from "./application-ui";

/** Keep each application's page source, portable builder and generated ESM together. */
export async function buildApplicationPages(resourcesRoot = resolve(import.meta.dir, "../packages/engine/src/modules/steward")) {
  const external = join(resourcesRoot, "external");
  for (const app of await readdir(external)) {
    const directory = join(external, app);
    const entry = app === "web" ? "src/memory-settings.tsx" : ["files", "remind"].includes(app) ? "page-ui.tsx" : "settings-ui.tsx";
    if (!await Bun.file(join(directory, entry)).exists()) continue;
    if (["web", "qq", "mcp"].includes(app)) {
      const template = await readFile(join(import.meta.dir, "../packages/engine/src/modules/steward/entry-app/memory-settings.tsx"), "utf8");
      const types = app === "web" ? "./registered-page" : "../web/src/registered-page";
      await writeFile(join(directory, entry), "// Generated from entry-app/memory-settings.tsx by build/application-pages.ts.\n" + template.replace("../external/web/src/registered-page", types));
    }
    await copyFile(join(import.meta.dir, "application-ui.ts"), join(directory, "build-ui.ts"));
    await buildApplicationUI(directory, entry, entry === "page-ui.tsx" ? "page-bundle.js" : "settings-bundle.js");
  }
}
if (import.meta.main) await buildApplicationPages(process.argv[2]);

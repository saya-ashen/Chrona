import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { applicationSourcePath, restoreApplications, type ApplicationInput } from "./restore-applications";

const root = resolve(import.meta.dirname, "..");
await restoreApplications(root);
const lock = JSON.parse(await readFile(join(root, "resources/application-inputs/lock.json"), "utf8")) as { applications: ApplicationInput[] };
for (const app of lock.applications) {
  const directory = join(root, applicationSourcePath, app.name);
  if (!await Bun.file(join(directory, "bun.lock")).exists()) continue;
  const child = Bun.spawn([process.execPath, "install", "--frozen-lockfile", "--ignore-scripts", ...(process.argv.includes("--offline") ? ["--offline"] : [])], { cwd: directory, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Application dependency installation failed: ${app.name}`);
}

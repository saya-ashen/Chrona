import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSupervised } from "./index";

const [mode, root, extra, taskMode] = process.argv.slice(2);
const self = import.meta.path;
if (mode === "owner") {
  const task = spawnSupervised(process.execPath, [self, "task", root, taskMode ?? ""], { helperPath: extra });
  const ready = await task.ready;
  writeFileSync(join(root, "owner.json"), JSON.stringify({ ...ready, guardian: task.pid }));
  if (process.env.FIXTURE_OWNER_EXIT === "yes") {
    while (!existsSync(join(root, "leaf"))) await Bun.sleep(5);
    process.exit(23);
  }
} else {
  writeFileSync(join(root, mode), String(process.pid));
  if (mode !== "leaf") {
    spawn(process.execPath, [self, mode === "task" ? "middle" : "leaf", root, extra ?? ""], { detached: extra?.includes("escape"), stdio: "inherit" });
  }
  if (mode === "task" && extra?.includes("exit")) {
    while (!existsSync(join(root, "leaf"))) await Bun.sleep(5);
    process.exit(7);
  }
}
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);

// Real Node runtime fixture; the wrapper is transpiled locally by the Bun test.
import { spawn } from "node:child_process";
import process from "node:process";
import { setInterval, setTimeout } from "node:timers";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const [mode, root, helper, wrapper, action] = process.argv.slice(2);
const self = fileURLToPath(import.meta.url);
const waitLeaf = async () => {
  while (!existsSync(join(root, "leaf"))) await new Promise(resolve => setTimeout(resolve, 5));
};
if (mode === "owner") {
  const { spawnSupervised } = await import(pathToFileURL(wrapper));
  const task = spawnSupervised(process.execPath, [self, "task", root, "", "", action], { helperPath: helper });
  task.process.stdin.end(); task.process.stdout.resume(); task.process.stderr.resume();
  await task.ready;
  await waitLeaf();
  writeFileSync(join(root, "owner.json"), JSON.stringify({ guardian: task.pid }));
  if (action === "cancel") task.stop();
  writeFileSync(join(root, "result.json"), JSON.stringify(await task.exited));
} else {
  writeFileSync(join(root, mode), String(process.pid));
  if (mode === "task") {
    spawn(process.execPath, [self, "leaf", root], { detached: true, stdio: "inherit" });
    if (action === "exit") { await waitLeaf(); process.exit(7); }
  }
  setInterval(() => {}, 1000);
}

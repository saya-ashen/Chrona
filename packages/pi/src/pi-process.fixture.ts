import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchPiProcess } from "./pi-process";

const [role, root, mode] = process.argv.slice(2) as [string, string, string];
if (role === "owner") {
  const task = launchPiProcess({ file: process.execPath, args: [import.meta.filename, "task", root, mode], cwd: root, env: process.env });
  task.stdout.resume(); task.stderr.resume(); task.stdin.end();
  await task.closed;
} else if (role === "task") {
  writeFileSync(join(root, "task"), String(process.pid));
  writeFileSync(join(root, "guardian"), String(process.ppid));
  // A new session escapes the task's process group, while retaining its pipes.
  spawn(process.execPath, [import.meta.filename, "leaf", root, mode], { detached: true, stdio: "inherit" });
  while (!existsSync(join(root, "leaf"))) await Bun.sleep(5);
  if (mode === "exit") process.exit(7);
  setInterval(() => {}, 1000);
} else if (role === "leaf") {
  writeFileSync(join(root, "leaf"), String(process.pid));
  setInterval(() => {}, 1000);
} else throw new Error("Unknown fixture role");

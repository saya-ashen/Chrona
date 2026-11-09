import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [mode, root, action = "exit"] = process.argv.slice(2) as [string, string, string?];
const self = import.meta.path;
if (mode === "sdk") {
  const { chrona } = await import(join(root, "sdk/sdk.ts"));
  const config = JSON.parse(action) as { action?: string; code?: string; options?: Record<string, unknown> };
  const controller = new AbortController();
  const timer = config.action === "cancel" ? setInterval(() => {
    if (existsSync(join(root, "leaf"))) controller.abort(new Error("Fixture cancelled"));
  }, 5) : undefined;
  try {
    const output = await chrona.exec(process.execPath, config.code ? ["-e", config.code] : [self, "task", root, config.action ?? "exit"], {
      ...config.options, ...(config.action === "cancel" ? { signal: controller.signal } : {}),
    });
    writeFileSync(join(root, "result.json"), JSON.stringify({ output }));
  } catch (error) {
    writeFileSync(join(root, "result.json"), JSON.stringify({ error: { name: (error as Error).name, message: (error as Error).message } }));
  } finally { clearInterval(timer); }
  process.exit(0);
}

writeFileSync(join(root, mode), String(process.pid));
if (mode === "task" && process.env.PASS_FILE) {
  console.log(process.env.PASS_FILE);
  console.log(readFileSync(process.env.PASS_FILE, "utf8"));
}
if (mode !== "leaf") spawn(process.execPath, [self, mode === "task" ? "middle" : "leaf", root, action], { detached: true, stdio: "inherit" });
if (mode === "task") {
  while (!existsSync(join(root, "leaf"))) await Bun.sleep(5);
  if (action === "exit") process.exit(7);
  if (action === "guardian-death") process.kill(process.ppid, "SIGKILL");
}
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);

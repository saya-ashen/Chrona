import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";

// systemd user-manager environment is not the Provider's filtered environment.
// Pass only approved names (values travel through D-Bus Environment, never argv).
export async function runExecutorProcessEntry(arguments_: string[]): Promise<void> {
  const [names, ready, file, ...args] = arguments_;
  if (!names || !ready || !file) throw new Error("Executor entry missing trusted launch arguments");
  const allowed = JSON.parse(names) as string[];
  const env = Object.fromEntries(allowed.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  const until = Date.now() + 6000;
  while (!existsSync(ready)) {
    if (Date.now() >= until) throw new Error("Executor identity was not durably admitted");
    await Bun.sleep(25);
  }
  unlinkSync(ready);
  const result = spawnSync(file, args, { env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (import.meta.main) await runExecutorProcessEntry(process.argv.slice(2));

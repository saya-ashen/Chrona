import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { version } from "../../package.json";
import { exports as sdkExports } from "../../packages/app-sdk/package.json";

const root = join(import.meta.dir, "../..");
const output = join(root, "dist");
mkdirSync(output, { recursive: true });
const staging = mkdtempSync(join(output, "sdk-pack-"));

try {
  const exports = { ...sdkExports, "./preview": "./preview.ts" };
  const files = [...new Set([
    ...Object.values(exports).map(path => path.slice(2)),
    "calls.d.ts", "module-entry.ts", "windows-transport.ts", "build-contract.md",
  ])];
  for (const file of files) copyFileSync(join(root, "packages/app-sdk", file), join(staging, file));
  copyFileSync(join(root, "LICENSE"), join(staging, "LICENSE"));
  writeFileSync(join(staging, "package.json"), JSON.stringify({
    name: "@chrona-org/sdk",
    version,
    description: "Application SDK for Chrona (Bun)",
    license: "MIT",
    type: "module",
    exports,
    files,
    publishConfig: { access: "public" },
  }, null, 2) + "\n");
  const result = Bun.spawnSync([process.execPath, "pm", "pack", "--ignore-scripts", "--destination", output], {
    cwd: staging,
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = result.exitCode;
} finally {
  rmSync(staging, { recursive: true, force: true });
}

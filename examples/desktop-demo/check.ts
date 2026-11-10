import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
const root = import.meta.dirname;
const checkout = resolve(root, "../..");
const sdk = process.env.CHRONA_SDK ?? join(checkout, "packages/integrations/src/steward/module-sdk");
const loader = process.env.CHRONA_SDK_LOADER ?? join(checkout, "packages/integrations/src/steward/module-typecheck/chrona-sdk-loader.ts");
const helper = process.env.CHRONA_PROCESS_HELPER ?? join(checkout, `packages/process/bin/${process.platform}-${process.arch}/chrona-process-guardian`);
for (const path of [join(root, "dist/entry.js"), join(sdk, "sdk.ts"), loader, helper]) if (!existsSync(path)) throw new Error(`Missing ${path}; build first and provide the matching Chrona SDK/guardian`);
const proc = Bun.spawn([process.execPath, "--no-install", "--preload", loader, join(root, "test.ts")], {
  cwd: root, env: { ...process.env, CHRONA_MODULE: root, CHRONA_SDK: sdk, CHRONA_SDK_LOADER: loader, CHRONA_PROCESS_HELPER: helper },
  stdout: "inherit", stderr: "inherit",
});
process.exit(await proc.exited);

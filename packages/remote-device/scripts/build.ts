import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLinuxArtifact } from "./linux-artifact";

if (process.platform !== "linux") throw new Error("Only native Linux device builds are verified");
const root = resolve(import.meta.dir, ".."), output = join(root, "dist");
mkdirSync(output, { recursive: true, mode: 0o700 });
const processPackage = resolve(dirname(fileURLToPath(import.meta.resolve("@chrona/process"))), ".."), piPackage = resolve(dirname(fileURLToPath(import.meta.resolve("@chrona/pi"))), "..");
const helper = join(output, "chrona-process-guardian");
const compiled = spawnSync(process.env.CC ?? "cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", join(processPackage, "native/guardian.c"), "-o", helper], { encoding: "utf8" });
if (compiled.error || compiled.status !== 0) throw new Error(`Native helper build failed: ${compiled.stderr}`);
normalizeLinuxArtifact(helper);
chmodSync(helper, 0o700);
const resources = [{ name: "chrona-process-guardian", path: helper, mode: 0o700 }, { name: "chrona-tools.ts", path: join(piPackage, "resources/chrona-tools.ts"), mode: 0o600 }, { name: "browser-tools.ts", path: join(piPackage, "resources/browser-tools.ts"), mode: 0o600 }].map(({ name, path, mode }) => {
  const bytes = readFileSync(path);
  return { name, mode, sha256: createHash("sha256").update(bytes).digest("hex"), base64: bytes.toString("base64") };
});
const artifact = join(output, "chrona-remote-device");
const built = await Bun.build({ entrypoints: [join(root, "src/cli.ts")], target: "bun", minify: true, compile: { outfile: artifact }, plugins: [{ name: "standalone-device-resources", setup(build) {
  build.onLoad({ filter: /\/bundled-resources\.ts$/ }, () => ({ loader: "ts", contents: `export const bundledPlatform = ${JSON.stringify(`${process.platform}-${process.arch}`)}; export const bundledResources = ${JSON.stringify(resources)};` }));
} }] });
if (!built.success) throw new AggregateError(built.logs, "Device bundling failed");
normalizeLinuxArtifact(artifact);
chmodSync(artifact, 0o755);
console.log(artifact);

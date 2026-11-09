import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Build-time tool only. Launching supervised tasks never invokes a compiler. */
export function buildProcessHelper(output: string, compiler = process.env.CC ?? (process.platform === "win32" ? "cl" : "cc")) {
  if (!["linux", "darwin", "win32"].includes(process.platform)) throw new Error("No native process backend for this platform");
  mkdirSync(dirname(output), { recursive: true });
  const windows = process.platform === "win32";
  const source = fileURLToPath(new URL(windows ? "../native/guardian-windows.c" : "../native/guardian.c", import.meta.url));
  const msvc = windows && /^(cl|clang-cl)(\.exe)?$/i.test(basename(compiler));
  const flags = msvc
    ? ["/nologo", "/std:c11", "/O2", "/W4", "/WX", source, `/Fe:${output}`, `/Fo:${output}.obj`]
    : ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", ...(windows ? ["-municode"] : []), source, "-o", output];
  const result = spawnSync(compiler, flags, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Process helper build failed: ${result.stdout}${result.stderr}`);
  return output;
}

if (import.meta.main) {
  const output = resolve(process.argv[2] ?? fileURLToPath(new URL(`../bin/${process.platform}-${process.arch}/chrona-process-guardian${process.platform === "win32" ? ".exe" : ""}`, import.meta.url)));
  console.log(buildProcessHelper(output));
}

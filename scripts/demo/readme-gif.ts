import { mkdir, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

import {
  buildGifCommands,
  createDemoArtifactPaths,
  findRecordedVideo,
} from "../../src/lib/demo-artifacts";

function quote(value: string) {
  return value.includes(" ") ? JSON.stringify(value) : value;
}

async function listFilesRecursively(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = resolve(path, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursively(fullPath);
      }
      return [fullPath];
    }),
  );
  return nested.flat();
}

async function runCommand(command: string[], cwd: string) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Command failed (${code}): ${command.map(quote).join(" ")}`));
    });
  });
}

async function main() {
  const repoRoot = process.cwd();
  const paths = createDemoArtifactPaths(repoRoot);

  await rm(paths.artifactsDir, { recursive: true, force: true });
  await mkdir(paths.playwrightOutputDir, { recursive: true });
  await mkdir(dirname(paths.gifPath), { recursive: true });

  await runCommand(["bunx", "playwright", "install", "chromium"], repoRoot);

  await runCommand(
    ["bunx", "playwright", "test", "--config=playwright.demo.config.ts"],
    repoRoot,
  );

  const recordedFiles = await listFilesRecursively(paths.playwrightOutputDir);
  const videoPath = findRecordedVideo(recordedFiles);
  const ffmpegCommands = buildGifCommands({
    inputVideoPath: videoPath,
    palettePath: paths.palettePath,
    outputGifPath: paths.gifPath,
  });

  await runCommand(ffmpegCommands.palette, repoRoot);
  await runCommand(ffmpegCommands.gif, repoRoot);

  console.log(`\nREADME demo GIF written to ${paths.gifPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

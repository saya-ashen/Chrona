import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { buildArtifacts, buildTargets } from "./manifest";
import { smokeRelease } from "./release-smoke";

const target = "linux-x64";
const releaseDir = resolve(import.meta.dirname, "..", "dist/releases", buildTargets[target].releaseName);
const binaryPath = resolve(releaseDir, buildTargets[target].binaryName);

async function writeRelease({ plugin = false } = {}) {
  await mkdir(resolve(releaseDir, buildArtifacts.resourcesRoot, buildArtifacts.webDist), { recursive: true });
  await mkdir(resolve(releaseDir, buildArtifacts.resourcesRoot, "prisma/migrations/20260101000000_init"), { recursive: true });
  await writeFile(binaryPath, "#!/bin/sh\n");
  await chmod(binaryPath, 0o755);
  await writeFile(resolve(releaseDir, buildArtifacts.resourcesRoot, buildArtifacts.webDist, "index.html"), "<html></html>");
  await writeFile(resolve(releaseDir, buildArtifacts.resourcesRoot, "prisma/schema.prisma"), "datasource db {}\n");
  if (plugin) {
    await mkdir(resolve(releaseDir, buildArtifacts.resourcesRoot, "external-plugins/hermes"), { recursive: true });
  }
}

describe("release smoke", () => {
  afterEach(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  it("checks binary executable bit plus required resources", async () => {
    await writeRelease({ plugin: true });
    await expect(smokeRelease(target)).resolves.toBeUndefined();
  });

  it("fails when required web index is missing", async () => {
    await writeRelease();
    await rm(resolve(releaseDir, buildArtifacts.resourcesRoot, buildArtifacts.webDist, "index.html"));
    await expect(smokeRelease(target)).rejects.toThrow("Web index missing");
  });

  it("allows optional plugin to be absent when source is absent", async () => {
    await writeRelease();
    await expect(smokeRelease(target, { pluginSource: "missing-plugin-source" })).resolves.toBeUndefined();
  });
});

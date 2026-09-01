import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { buildArtifacts, buildTargets } from "../build/manifest";
import { releaseSmokeEnvironment, smokeRelease } from "../build/release-smoke";

const target = "linux-x64";
const fixtureRoots: string[] = [];

function createElfFixture(interpreter: string = buildTargets[target].linuxInterpreter) {
  const binary = Buffer.alloc(256);
  binary.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  binary.writeBigUInt64LE(64n, 32);
  binary.writeUInt16LE(64, 52);
  binary.writeUInt16LE(56, 54);
  binary.writeUInt16LE(1, 56);

  binary.writeUInt32LE(3, 64);
  binary.writeBigUInt64LE(128n, 72);
  binary.writeBigUInt64LE(64n, 96);
  binary.writeBigUInt64LE(64n, 104);
  binary.write(`${interpreter}\0`, 128, "utf8");
  return binary;
}

async function writeRelease({ plugin = false, interpreter }: { plugin?: boolean; interpreter?: string } = {}) {
  const releaseRoot = await mkdtemp(join(tmpdir(), "chrona-release-smoke-test-"));
  const releaseDir = resolve(releaseRoot, buildTargets[target].releaseName);
  const binaryPath = resolve(releaseDir, buildTargets[target].binaryName);
  fixtureRoots.push(releaseRoot);

  await mkdir(resolve(releaseDir, buildArtifacts.resourcesRoot, buildArtifacts.webDist), { recursive: true });
  await mkdir(resolve(releaseDir, buildArtifacts.resourcesRoot, "prisma/migrations/20260101000000_init"), { recursive: true });
  await writeFile(binaryPath, createElfFixture(interpreter));
  await chmod(binaryPath, 0o755);
  await writeFile(resolve(releaseDir, buildArtifacts.resourcesRoot, buildArtifacts.webDist, "index.html"), "<html></html>");
  await writeFile(resolve(releaseDir, buildArtifacts.resourcesRoot, "prisma/schema.prisma"), "datasource db {}\n");

  const nativePackageDir = resolve(import.meta.dirname, "..", "node_modules", ...buildTargets[target].nativePackage.split("/"));
  const nativeAddonNames = (await readdir(nativePackageDir)).filter((name) => name.endsWith(".node"));
  for (const nativeAddonName of nativeAddonNames) {
    await writeFile(resolve(releaseDir, nativeAddonName), "fixture");
  }

  if (plugin) {
    await mkdir(resolve(releaseDir, buildArtifacts.resourcesRoot, "external-plugins/hermes"), { recursive: true });
  }

  return { releaseDir, releaseRoot };
}

describe("release smoke", () => {
  afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("isolates the runtime database from an inherited DATABASE_URL", () => {
    expect(releaseSmokeEnvironment("/tmp/chrona-data", "/tmp/chrona-config", {
      DATABASE_URL: "file:/user/database.db",
    })).toMatchObject({
      CHRONA_CONFIG_DIR: "/tmp/chrona-config",
      CHRONA_DATA_DIR: "/tmp/chrona-data",
      DATABASE_URL: "file:/tmp/chrona-data/chrona.db",
    });
  });

  it("checks binary executable bit plus required resources", async () => {
    const fixture = await writeRelease({ plugin: true });
    await expect(smokeRelease(target, { releaseRoot: fixture.releaseRoot, runtime: false })).resolves.toBeUndefined();
  });

  it("fails when required web index is missing", async () => {
    const fixture = await writeRelease();
    await rm(resolve(fixture.releaseDir, buildArtifacts.resourcesRoot, buildArtifacts.webDist, "index.html"));
    await expect(smokeRelease(target, { releaseRoot: fixture.releaseRoot })).rejects.toThrow("Web index missing");
  });

  it("allows optional plugin to be absent when source is absent", async () => {
    const fixture = await writeRelease();
    await smokeRelease(target, {
      pluginSource: "missing-plugin-source",
      releaseRoot: fixture.releaseRoot,
      runtime: false,
    });
  });

  it("rejects a Linux binary with a host-specific ELF interpreter", async () => {
    const fixture = await writeRelease({ interpreter: "/nix/store/example-glibc/lib/ld-linux-x86-64.so.2" });
    await expect(smokeRelease(target, { releaseRoot: fixture.releaseRoot, runtime: false })).rejects.toThrow(
      "non-portable ELF interpreter",
    );
  });
});

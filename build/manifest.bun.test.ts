import { describe, expect, it } from "bun:test";

import { buildArtifacts, buildTargets, currentBuildTarget, parseBuildTarget } from "./manifest";

describe("build manifest", () => {
  it("keeps release resources in one source of truth", () => {
    expect(buildArtifacts.binaryEntry).toBe("packages/cli/src/bun-entry.ts");
    expect(buildArtifacts.resources.map((resource) => resource.to)).toEqual([
      "resources/apps/web/dist",
      "resources/prisma/schema.prisma",
      "resources/prisma/migrations",
      "resources/.env.example",
      "resources/external-plugins/hermes",
    ]);
  });

  it("maps supported release targets", () => {
    expect(buildTargets["linux-x64"]).toMatchObject({
      bunTarget: "bun-linux-x64",
      releaseName: "chrona-linux-x64",
      binaryName: "chrona",
      nativePackage: "@oh-my-pi/pi-natives-linux-x64",
    });
    expect(buildTargets["windows-x64"]).toMatchObject({
      bunTarget: "bun-windows-x64",
      releaseName: "chrona-windows-x64",
      binaryName: "Chrona.exe",
      nativePackage: "@oh-my-pi/pi-natives-win32-x64",
    });
  });

  it("parses explicit target before platform auto-detection", () => {
    expect(parseBuildTarget(["--target", "darwin-arm64"], "linux", "x64")).toBe("darwin-arm64");
    expect(currentBuildTarget("linux", "x64")).toBe("linux-x64");
  });
});

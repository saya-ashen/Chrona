export type BuildTargetName = keyof typeof buildTargets;

export type ReleaseResource = {
  from: string;
  to: string;
  required: boolean;
};

export const buildArtifacts = {
  binaryEntry: "packages/cli/src/bun-entry.ts",
  webDist: "apps/web/dist",
  resourcesRoot: "resources",
  resources: [
    { from: "apps/web/dist", to: "resources/apps/web/dist", required: true },
    { from: "prisma/schema.prisma", to: "resources/prisma/schema.prisma", required: true },
    { from: "prisma/migrations", to: "resources/prisma/migrations", required: true },
    { from: ".env.example", to: "resources/.env.example", required: false },
    { from: "external-plugins/hermes", to: "resources/external-plugins/hermes", required: false },
  ] satisfies ReleaseResource[],
} as const;

export const buildTargets = {
  "linux-x64": {
    bunTarget: "bun-linux-x64",
    releaseName: "chrona-linux-x64",
    binaryName: "chrona",
    executable: true,
  },
  "linux-arm64": {
    bunTarget: "bun-linux-arm64",
    releaseName: "chrona-linux-arm64",
    binaryName: "chrona",
    executable: true,
  },
  "darwin-x64": {
    bunTarget: "bun-darwin-x64",
    releaseName: "chrona-darwin-x64",
    binaryName: "chrona",
    executable: true,
  },
  "darwin-arm64": {
    bunTarget: "bun-darwin-arm64",
    releaseName: "chrona-darwin-arm64",
    binaryName: "chrona",
    executable: true,
  },
  "windows-x64": {
    bunTarget: "bun-windows-x64",
    releaseName: "chrona-windows-x64",
    binaryName: "Chrona.exe",
    executable: false,
  },
} as const;

export function currentBuildTarget(platform = process.platform, arch = process.arch): BuildTargetName {
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "win32" && arch === "x64") return "windows-x64";
  throw new Error(`Cannot auto-detect target for ${platform}-${arch}. Pass --target <target>`);
}

export function parseBuildTarget(args: string[], platform = process.platform, arch = process.arch): BuildTargetName {
  const targetIdx = args.indexOf("--target");
  const target = targetIdx === -1 ? currentBuildTarget(platform, arch) : args[targetIdx + 1];
  if (!target || !(target in buildTargets)) {
    throw new Error(`Unknown target: ${target}. Supported: ${Object.keys(buildTargets).join(", ")}`);
  }
  return target as BuildTargetName;
}

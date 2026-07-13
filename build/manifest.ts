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

const PLATFORM_TARGETS: Partial<Record<NodeJS.Platform, Partial<Record<string, BuildTargetName>>>> = {
  linux: { x64: "linux-x64", arm64: "linux-arm64" },
  darwin: { x64: "darwin-x64", arm64: "darwin-arm64" },
  win32: { x64: "windows-x64" },
};

export function currentBuildTarget(platform = process.platform, arch = process.arch): BuildTargetName {
  const target = PLATFORM_TARGETS[platform]?.[arch];
  if (target) return target;
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

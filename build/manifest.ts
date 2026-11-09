import { rm } from "node:fs/promises";
import { resolve } from "node:path";

export type BuildTargetName = keyof typeof buildTargets;

export type ReleaseResource = {
  from: string;
  to: string;
  required: boolean;
};

export const buildArtifacts = {
  binaryEntry: "packages/cli/src/bun-entry.ts",
  resourcesRoot: "resources",
  moduleGit: {
    resourcesDir: "module-git",
    seedDir: "resources/module-git",
    modules: [
      { name: "web", source: "external/web" },
      { name: "mcp", source: "external/mcp" },
      { name: "files", source: "external/files" },
      { name: "notify", source: "external/notify" },
      { name: "events", source: "external/events" },
      { name: "agent", source: "builtin/agent" },
      { name: "qq", source: "external/qq" },
      { name: "author", source: "external/author" },
      { name: "remind", source: "external/remind" },
      { name: "mind", source: "external/mind" },
      { name: "memory-local", source: "external/memory-local" },
      { name: "coding", source: "external/coding" },
      { name: "coding-web", source: "external/coding-web" },
      { name: "remote-execution", source: "external/remote-execution" },
    ],
  },
  // Seeds keep provenance for retained sources; these trees must never ship as runtime packages.
  pausedModuleResources: ["external/mind", "external/remind"],
  resources: [
    { from: "apps/server/src/static/rescue.html", to: "resources/rescue.html", required: true },
    { from: "prisma/schema.prisma", to: "resources/prisma/schema.prisma", required: true },
    { from: "prisma/migrations", to: "resources/prisma/migrations", required: true },
    { from: ".env.example", to: "resources/.env.example", required: false },
    { from: "packages/pi/resources", to: "resources/pi", required: true },
    { from: "packages/engine/src/modules/steward/builtin", to: "resources/builtin", required: true },
    { from: "packages/engine/src/modules/steward/external", to: "resources/external", required: true },
    { from: "packages/integrations/src/steward/module-sdk/package.json", to: "resources/module-sdk/package.json", required: true },
    { from: "packages/integrations/src/steward/module-typecheck/chrona-sdk-loader.ts", to: "resources/module-sdk/chrona-sdk-loader.ts", required: true },
    { from: "packages/integrations/src/steward/module-sdk/sdk.ts", to: "resources/module-sdk/sdk.ts", required: true },
    { from: "packages/integrations/src/steward/module-sdk/transport.ts", to: "resources/module-sdk/transport.ts", required: true },
    { from: "packages/integrations/src/steward/module-sdk/process.ts", to: "resources/module-sdk/process.ts", required: true },
    { from: "packages/integrations/src/steward/module-sdk/windows-transport.ts", to: "resources/module-sdk/windows-transport.ts", required: true },
    { from: "packages/integrations/src/steward/module-sdk/testing.ts", to: "resources/module-sdk/testing.ts", required: true },
    { from: "packages/integrations/src/steward/module-sdk/preview.ts", to: "resources/module-sdk/preview.ts", required: true },
    { from: "packages/integrations/src/steward/module-sdk/build-contract.md", to: "resources/module-sdk/build-contract.md", required: true },
    { from: "packages/integrations/src/steward/module-sdk/group-build-contract.md", to: "resources/module-sdk/group-build-contract.md", required: true },
    { from: "packages/integrations/src/steward/module-sdk/calls.d.ts", to: "resources/module-sdk/calls.d.ts", required: true },
    // v2-25: the module type check runs with Bun, so it ships TypeScript and Bun's types beside it.
    { from: "packages/integrations/src/steward/runtimes.json", to: "resources/runtimes.json", required: true },
    { from: "packages/integrations/src/steward/module-typecheck/chrona-sdk-loader.ts", to: "resources/module-typecheck/chrona-sdk-loader.ts", required: true },
    { from: "packages/integrations/src/steward/module-typecheck/calls.ts", to: "resources/module-typecheck/calls.ts", required: true },
    { from: "packages/integrations/src/steward/module-typecheck/check.ts", to: "resources/module-typecheck/check.ts", required: true },
    { from: "node_modules/typescript/package.json", to: "resources/module-typecheck/node_modules/typescript/package.json", required: true },
    { from: "node_modules/typescript/lib", to: "resources/module-typecheck/node_modules/typescript/lib", required: true },
    { from: "node_modules/@types/bun", to: "resources/module-typecheck/node_modules/@types/bun", required: true },
    { from: "node_modules/bun-types", to: "resources/module-typecheck/node_modules/bun-types", required: true },
    { from: "node_modules/@types/node", to: "resources/module-typecheck/node_modules/@types/node", required: true },
  ] satisfies ReleaseResource[],
} as const;

/** Apply only to staged distribution resources, after verifying all fixed source seeds. */
export async function omitPausedRuntimeModules(resourcesRoot: string): Promise<void> {
  for (const source of buildArtifacts.pausedModuleResources) await rm(resolve(resourcesRoot, source), { recursive: true, force: true });
}

export const buildTargets = {
  "linux-x64": {
    bunTarget: "bun-linux-x64",
    releaseName: "chrona-linux-x64",
    binaryName: "chrona",
    executable: true,
    linuxInterpreter: "/lib64/ld-linux-x86-64.so.2",
  },
  "linux-arm64": {
    bunTarget: "bun-linux-arm64",
    releaseName: "chrona-linux-arm64",
    binaryName: "chrona",
    executable: true,
    linuxInterpreter: "/lib/ld-linux-aarch64.so.1",
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

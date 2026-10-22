import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readPiResources, resourceCommand, resourceVersionError } from "./pi-resources";
import { expectedPiCommands, piArguments, piLaunchConfig } from "./pi-launch";
import type { ProviderRunInput } from "@chrona/contracts/steward";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-reviewed-pi-")), profile = await mkdtemp(join(tmpdir(), "chrona-resource-profile-")), workspace = await mkdtemp(join(tmpdir(), "chrona-resource-work-"));
  const file = join(root, "resources.json"), skill = join(root, "SKILL.md"), extension = join(root, "extension.ts");
  await writeFile(skill, "---\nname: fixture\ndescription: Fake skill\n---\nNo action.\n"); await writeFile(extension, "");
  const value = { skills: [skill], extensions: [extension], tools: ["fixture_tool"] };
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  return { root, profile, workspace, file, skill, extension, value };
}
test("loads only reviewed explicit resources, keeping no-discovery and scoped command validation", async () => {
  const f = await fixture(), loaded = readPiResources(f.file, f.profile, f.workspace);
  expect(loaded.error).toBeNull(); expect(loaded.resources).toEqual(f.value);
  const config = piLaunchConfig({ command: "/not-run", agentDir: f.profile, chronaExtension: f.extension, resourcesFile: f.file, workspaceRoot: f.workspace, agentUrl: "http://127.0.0.1:1234/api/steward-agent" });
  const args = piArguments(config, { cwd: f.workspace, sessionDir: join(f.workspace, "sessions"), sessionId: null, lane: "foreground" } as ProviderRunInput, "Fixture");
  expect(args).toContain("--no-skills"); expect(args).toContain("--skill"); expect(args).toContain(f.skill); expect(args[args.indexOf("--tools") + 1]).toContain("fixture_tool");
  expect(expectedPiCommands(config, [{ source: "skill", sourceInfo: { path: f.skill } }])).toBe(true);
  expect(expectedPiCommands(config, [{ source: "skill", sourceInfo: { path: join(f.root, "ambient.md") } }])).toBe(false);
  expect(expectedPiCommands(config, [{ source: "prompt", path: f.skill }])).toBe(false);
});
test("bwrap masks data and home before re-exposing only Pi resources and workspaces", async () => {
  const f = await fixture(), dataDir = f.root, workspace = join(dataDir, "affairs"), sessions = join(workspace, ".chrona", "sessions");
  const affair = join(workspace, "a".repeat(32)), agentDir = join(dataDir, "providers", "pi");
  for (const path of [sessions, affair, agentDir]) await mkdir(path, { recursive: true });
  const command = join(dataDir, "fake-pi"); await writeFile(command, "synthetic executable");
  const config = piLaunchConfig({ command, agentDir, dataDir, workspaceRoot: workspace,
    chronaExtension: f.extension, resourcesFile: f.file, bwrap: "/fake-bwrap", agentUrl: "http://127.0.0.1:1234" });
  const args = piArguments(config, { cwd: workspace, sessionDir: sessions, sessionId: null, lane: "foreground" } as ProviderRunInput, "Fixture");
  const mount = (flag: string, path: string) => args.findIndex((arg, i) => arg === flag && args[i + 1] === path);
  for (const path of [dataDir, homedir()]) {
    const mask = mount("--tmpfs", path);
    expect(mask).toBeGreaterThan(mount("--ro-bind", "/") + 2);
    for (const path of [command, f.extension, f.skill, workspace]) expect(mask).toBeLessThan(mount("--ro-bind", path));
    for (const path of [sessions, affair, agentDir]) expect(mask).toBeLessThan(mount("--bind", path));
  }
  expect(mount("--bind", dataDir)).toBe(-1);
  expect(mount("--bind", homedir())).toBe(-1);
  const unsandboxed = piArguments({ ...config, bwrap: null }, { cwd: workspace, sessionDir: sessions, sessionId: null, lane: "foreground" } as ProviderRunInput, "Fixture");
  expect(unsandboxed).not.toContain("--tmpfs");
});
test("bwrap binds approved host paths writable and re-masks the data dir under them", async () => {
  const f = await fixture(), dataDir = join(f.root, "data"), workspace = join(dataDir, "affairs"), sessions = join(workspace, ".chrona", "sessions");
  const agentDir = join(dataDir, "providers", "pi"), granted = await mkdtemp(join(tmpdir(), "chrona-granted-"));
  for (const path of [sessions, agentDir]) await mkdir(path, { recursive: true });
  const config = piLaunchConfig({ command: "/fake-pi", agentDir, dataDir, workspaceRoot: workspace, chronaExtension: f.extension, bwrap: "/fake-bwrap", agentUrl: "http://127.0.0.1:1234" });
  const args = piArguments(config, { cwd: workspace, sessionDir: sessions, sessionId: null, lane: "foreground", hostPaths: [f.root, granted, join(f.root, "missing")] } as ProviderRunInput, "Fixture");
  const mount = (flag: string, path: string) => args.findIndex((arg, i) => arg === flag && args[i + 1] === path);
  expect(mount("--bind", granted)).toBeGreaterThan(mount("--tmpfs", homedir()));
  expect(mount("--bind", join(f.root, "missing"))).toBe(-1);
  const remask = args.findLastIndex((arg, i) => arg === "--tmpfs" && args[i + 1] === dataDir);
  expect(remask).toBeGreaterThan(mount("--bind", f.root));
  expect(remask).toBeLessThan(mount("--ro-bind", workspace));
  expect(remask).toBeLessThan(mount("--bind", agentDir));
});
test("missing/invalid manifest never falls back to ambient resources", async () => {
  const f = await fixture();
  expect(readPiResources(undefined, f.profile).resources).toEqual({ skills: [], extensions: [], tools: [] });
  for (const value of [{ tools: ["bash --unsafe"] }, { skills: ["relative.md"] }, { extensions: ["builtin:unknown"] }, { install: "anything" }]) {
    await writeFile(f.file, JSON.stringify(value)); expect(readPiResources(f.file, f.profile).error).not.toBeNull();
  }
  await writeFile(f.file, "not-json"); expect(readPiResources(f.file, f.profile).error).not.toBeNull();
});
test("refuses profile/workspace-owned manifests, symlinks and writable extension entries", async () => {
  const f = await fixture();
  for (const directory of [f.profile, f.workspace]) {
    const file = join(directory, "resources.json"); await writeFile(file, "{}", { mode: 0o600 });
    expect(readPiResources(file, f.profile, f.workspace).error).not.toBeNull();
  }
  const link = join(f.root, "link.json"); await symlink(f.file, link);
  expect(readPiResources(link, f.profile).error).not.toBeNull();
  if (process.platform !== "win32") {
    await chmod(f.file, 0o644); expect(readPiResources(f.file, f.profile).error).not.toBeNull(); await chmod(f.file, 0o600);
    await chmod(f.extension, 0o666); expect(readPiResources(f.file, f.profile).error).not.toBeNull();
  }
});
test("native MCP stays in Pi, explicit 1.3 and sandbox rules are enforced", () => {
  const selected = { skills: [], extensions: ["builtin:mcp"], tools: ["mcp__fixture__ping"] };
  expect(resourceVersionError(selected, "0.85.0", true)).toContain("1.3.0");
  expect(resourceVersionError(selected, "1.3.0", false)).toBeNull();
  expect(resourceCommand(selected, "extension", "builtin:mcp", [])).toBe(true);
  expect(resourceCommand(selected, "extension", "builtin:codemode", [])).toBe(false);
  expect(resourceVersionError({ ...selected, extensions: ["builtin:codemode"] }, "1.3.0", false)).toContain("bubblewrap");
  expect(resourceVersionError({ ...selected, tools: ["bash"] }, "1.3.0", false)).toContain("bubblewrap");
});

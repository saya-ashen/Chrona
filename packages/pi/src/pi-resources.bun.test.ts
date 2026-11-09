import { expect, test } from "bun:test";
import { chmod, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPiResources, resourceCommand, resourceVersionError } from "./pi-resources";
import { expectedPiCommands, inspectPiLaunch, piArguments, piLaunchConfig } from "./pi-launch";
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
  const args = piArguments(config, { cwd: f.workspace, sessionDir: join(f.workspace, "sessions"), sessionId: null, resources: "configured", lane: "foreground" } as ProviderRunInput, "Fixture");
  expect(args).toContain("--no-skills"); expect(args).toContain("--skill"); expect(args).toContain(f.skill); expect(args[args.indexOf("--tools") + 1]).toContain("fixture_tool");
  expect(expectedPiCommands(config, [{ source: "skill", sourceInfo: { path: f.skill } }])).toBe(true);
  expect(expectedPiCommands(config, [{ source: "skill", sourceInfo: { path: join(f.root, "ambient.md") } }])).toBe(false);
  expect(expectedPiCommands(config, [{ source: "prompt", path: f.skill }])).toBe(false);
});
test("trusted-local arguments launch Pi RPC directly with configured resources", async () => {
  const f = await fixture();
  const config = piLaunchConfig({ command: join(f.root, "fake-pi"), agentDir: f.profile, workspaceRoot: f.workspace,
    chronaExtension: f.extension, resourcesFile: f.file, executionMode: "trusted-local", agentUrl: "http://127.0.0.1:1234" });
  const args = piArguments(config, { cwd: f.workspace, sessionDir: join(f.workspace, "sessions"), sessionId: "session-id", resources: "configured", lane: "foreground", hostPaths: [f.root] } as ProviderRunInput, "Fixture");
  expect(args.slice(0, 6)).toEqual(["--mode", "rpc", "--session-dir", join(f.workspace, "sessions"), "--session-id", "session-id"]);
  expect(args).toContain(f.extension); expect(args).toContain(f.skill);
  expect(args[args.indexOf("--tools") + 1]!.split(",")).toContain("bash");
  expect(args).not.toContain("--bind"); expect(args).not.toContain("--tmpfs");
  expect(args).not.toContain(config.command);
});
test("legacy required-isolation fails before probing or assembling a local launch", async () => {
  const f = await fixture();
  const config = piLaunchConfig({ command: join(f.root, "missing-pi"), agentDir: f.profile,
    chronaExtension: f.extension, executionMode: "required-isolation", agentUrl: "http://127.0.0.1:1234" });
  expect(await inspectPiLaunch(config)).toBe("Pi required-isolation is no longer supported; configure trusted-local execution");
  expect(() => piArguments(config, { cwd: f.workspace, sessionDir: f.workspace } as ProviderRunInput, "Fixture")).toThrow("required-isolation is no longer supported");
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
test("native MCP stays in Pi and Pi builtins need a 1.x pin of 1.3 or later", () => {
  const selected = { skills: [], extensions: ["builtin:mcp"], tools: ["mcp__fixture__ping"] };
  expect(resourceVersionError(selected, "0.85.0")).toContain("1.3.0");
  expect(resourceVersionError(selected, "1.2.9")).toContain("1.3.0");
  expect(resourceVersionError(selected, "2.0.0")).toContain("1.3.0");
  expect(resourceVersionError(selected, "1.3.0")).toBeNull();
  expect(resourceVersionError(selected, "1.4.0")).toBeNull();
  expect(resourceCommand(selected, "extension", "builtin:mcp", [])).toBe(true);
  expect(resourceCommand(selected, "extension", "builtin:codemode", [])).toBe(false);
  expect(resourceVersionError({ ...selected, tools: ["bash"] }, "1.3.0")).toBeNull();
});
test("a run gets the browser tool only with an installed browser and its explicit extension", async () => {
  const f = await fixture(), browserExtension = join(f.root, "browser-tools.ts"), browser = join(f.root, "host-chrome");
  await writeFile(browserExtension, ""); await writeFile(browser, "");
  const config = piLaunchConfig({ command: join(f.root, "fake-pi"), agentDir: f.profile, workspaceRoot: f.workspace,
    chronaExtension: f.extension, browserExtension, agentUrl: "http://127.0.0.1:1234" });
  const input = { cwd: f.workspace, sessionDir: join(f.workspace, "sessions"), sessionId: null, resources: "configured", lane: "build" } as ProviderRunInput;
  const tools = (args: string[]) => args[args.indexOf("--tools") + 1]!.split(",");
  const without = piArguments(config, input, "Fixture");
  expect(without).not.toContain(browserExtension);
  expect(tools(without)).not.toContain("browser_screenshot");
  const args = piArguments(config, input, "Fixture", browser);
  expect(args.slice(args.indexOf(browserExtension) - 1, args.indexOf(browserExtension) + 1)).toEqual(["-e", browserExtension]);
  expect(tools(args)).toContain("browser_screenshot");
  expect(args).not.toContain("--ro-bind");
  expect(tools(piArguments({ ...config, browserExtension: null }, input, "Fixture", browser))).not.toContain("browser_screenshot");
  expect(tools(piArguments(config, { ...input, resources: "minimal" }, "Fixture", browser))).not.toContain("browser_screenshot");
});

import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPiResources, resourceVersionError } from "./pi-resources";
import { inspectPiLaunch, piArguments, piLaunchConfig } from "./pi-launch";
import type { ProviderRunInput } from "@chrona/contracts/steward";
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-reviewed-pi-")), profile = await mkdtemp(join(tmpdir(), "chrona-resource-profile-")), workspace = await mkdtemp(join(tmpdir(), "chrona-resource-work-"));
  directories.push(root, profile, workspace);
  const file = join(root, "resources.json"), skill = join(root, "SKILL.md"), extension = join(root, "extension.ts");
  await writeFile(skill, "---\nname: fixture\ndescription: Fake skill\n---\nNo action.\n"); await writeFile(extension, "");
  const value = { skills: [skill], extensions: [extension], tools: ["fixture_tool"] };
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  return { root, profile, workspace, file, skill, extension, value };
}
function input(workspace: string, resources: "minimal" | "configured"): ProviderRunInput {
  return { cwd: workspace, sessionDir: join(workspace, "sessions"), sessionId: "session-id", resources, lane: "foreground" } as ProviderRunInput;
}
for (const resources of ["configured", "minimal"] as const) test(`${resources} inherits user discovery and approvals with additive manifest/web/browser resources`, async () => {
  const f = await fixture(), loaded = readPiResources(f.file, f.profile, f.workspace);
  expect(loaded.error).toBeNull(); expect(loaded.resources).toEqual(f.value);
  const bridge = join(f.root, "chrona-tools.ts"), web = join(f.root, "web-tools.ts"), browserExtension = join(f.root, "browser-tools.ts");
  const config = piLaunchConfig({ command: "/not-run", agentDir: f.profile, chronaExtension: bridge, webExtension: web, browserExtension, resourcesFile: f.file, workspaceRoot: f.workspace, agentUrl: "http://127.0.0.1:1234/api/steward-agent" });
  const args = piArguments(config, { ...input(f.workspace, resources), extraTools: ["m_ledger_add_expense"], searchTools: true }, "Fixture", "/fake-browser");
  expect(args.slice(0, 6)).toEqual(["--mode", "rpc", "--session-dir", join(f.workspace, "sessions"), "--session-id", "session-id"]);
  const extensions = args.flatMap((arg, index) => arg === "-e" ? [args[index + 1]] : []);
  expect(extensions).toEqual([bridge, web, browserExtension, f.extension, "builtin:tool-search"]);
  expect(args.slice(args.indexOf("--skill"), args.indexOf("--skill") + 2)).toEqual(["--skill", f.skill]);
  expect(args.slice(-2)).toEqual(["--append-system-prompt", "Fixture"]);
  for (const flag of ["--no-skills", "--no-extensions", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-approve", "--tools"]) expect(args).not.toContain(flag);
  // Extra module tools are admitted by the bridge's token-scoped catalog, not CLI names.
  expect(args).not.toContain("m_ledger_add_expense");
});
test("trusted-local arguments launch Pi RPC directly and preserve model overrides", async () => {
  const f = await fixture();
  const config = piLaunchConfig({ command: join(f.root, "fake-pi"), agentDir: f.profile, workspaceRoot: f.workspace,
    chronaExtension: f.extension, resourcesFile: f.file, executionMode: "trusted-local", model: "fixture/default", agentUrl: "http://127.0.0.1:1234" });
  const args = piArguments(config, { ...input(f.workspace, "configured"), model: "fixture/override" }, "Fixture");
  expect(args).toContain(f.extension); expect(args).toContain(f.skill);
  expect(args.slice(-2)).toEqual(["--model", "fixture/override"]);
  expect(args).not.toContain("--bind"); expect(args).not.toContain("--tmpfs");
  expect(args).not.toContain(config.command);
  expect(piArguments(config, input(f.workspace, "minimal"), "Fixture").slice(-2)).toEqual(["--model", "fixture/default"]);
});
test("legacy required-isolation fails before probing or assembling a local launch", async () => {
  const f = await fixture();
  const config = piLaunchConfig({ command: join(f.root, "missing-pi"), agentDir: f.profile,
    chronaExtension: f.extension, executionMode: "required-isolation", agentUrl: "http://127.0.0.1:1234" });
  expect(await inspectPiLaunch(config)).toBe("Pi required-isolation is no longer supported; configure trusted-local execution");
  expect(() => piArguments(config, input(f.workspace, "configured"), "Fixture")).toThrow("required-isolation is no longer supported");
});
test("an omitted manifest adds nothing and an invalid explicit manifest fails validation", async () => {
  const f = await fixture();
  expect(readPiResources(undefined, f.profile)).toEqual({ resources: { skills: [], extensions: [], tools: [] }, error: null });
  for (const value of [{ tools: ["bash --unsafe"] }, { skills: ["relative.md"] }, { extensions: ["builtin:unknown"] }, { install: "anything" }]) {
    await writeFile(f.file, JSON.stringify(value)); expect(readPiResources(f.file, f.profile).error).not.toBeNull();
  }
  await writeFile(f.file, "not-json"); expect(readPiResources(f.file, f.profile).error).not.toBeNull();
  const config = piLaunchConfig({ command: "/fake-pi", agentDir: f.profile, chronaExtension: f.extension, resourcesFile: f.file, agentUrl: "" });
  expect(await inspectPiLaunch(config)).toContain("Pi resource manifest");
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
});
for (const resources of ["configured", "minimal"] as const) test(`${resources} adds browser extension only when a browser and extension are available`, async () => {
  const f = await fixture(), browserExtension = join(f.root, "browser-tools.ts"), browser = join(f.root, "host-chrome");
  const config = piLaunchConfig({ command: join(f.root, "fake-pi"), agentDir: f.profile, workspaceRoot: f.workspace,
    chronaExtension: f.extension, browserExtension, agentUrl: "http://127.0.0.1:1234" });
  const run = input(f.workspace, resources);
  expect(piArguments(config, run, "Fixture")).not.toContain(browserExtension);
  expect(piArguments(config, run, "Fixture", browser)).toContain(browserExtension);
  expect(piArguments({ ...config, browserExtension: null }, run, "Fixture", browser)).not.toContain(browserExtension);
});
test("tool search is added only when requested and explicit extensions are deduplicated", async () => {
  const f = await fixture();
  await writeFile(f.file, JSON.stringify({ extensions: [f.extension, "builtin:tool-search", "builtin:tool-search"] }));
  const config = piLaunchConfig({ command: "/fake-pi", agentDir: f.profile, expectedVersion: "1.3.9", chronaExtension: f.extension, resourcesFile: f.file, agentUrl: "" });
  const args = piArguments(config, { ...input(f.workspace, "minimal"), searchTools: true }, "Fixture");
  expect(args.filter(value => value === "builtin:tool-search")).toHaveLength(1);
  expect(args.filter(value => value === f.extension)).toHaveLength(1);
  const plain = piLaunchConfig({ ...config.options, resourcesFile: undefined });
  expect(piArguments(plain, { ...input(f.workspace, "minimal"), extraTools: ["m_ledger_add_expense"] }, "Fixture")).not.toContain("builtin:tool-search");
});

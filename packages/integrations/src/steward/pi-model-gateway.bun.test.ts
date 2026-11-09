import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPiModelGateway, piHostConfiguration } from "./pi-model-gateway";

const keys = ["CHRONA_RESOURCE_DIR", "CHRONA_STEWARD_PI_COMMAND", "CHRONA_STEWARD_PI_AGENT_DIR", "CHRONA_STEWARD_PI_MODEL", "CHRONA_STEWARD_PI_VERSION", "CHRONA_STEWARD_PI_RESOURCES_FILE", "CHRONA_STEWARD_PI_WEB_EXTENSION", "CHRONA_STEWARD_EXECUTION_MODE", "CHRONA_STEWARD_SANDBOX_BWRAP"] as const;
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const roots: string[] = [];
afterEach(async () => {
  for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
function clearConfiguration() { for (const key of keys) delete process.env[key]; }

test("host configuration resolves Pi resources in source and release layouts", () => {
  clearConfiguration();
  const source = piHostConfiguration({ port: 3123, dataDir: "/host/data" });
  expect(source.chronaExtension).toBe(resolve("packages/pi/resources/chrona-tools.ts"));
  expect(existsSync(source.chronaExtension)).toBe(true);
  expect(existsSync(source.browserExtension!)).toBe(true);
  expect(source.agentUrl).toBe("http://127.0.0.1:3123/api/steward-agent");
  expect(source.agentDir).toBe("/host/data/providers/pi");
  process.env.CHRONA_RESOURCE_DIR = "/release/resources";
  const release = piHostConfiguration({ port: 3123, dataDir: "/host/data" });
  expect(release.chronaExtension).toBe("/release/resources/pi/chrona-tools.ts");
  expect(release.browserExtension).toBe("/release/resources/pi/browser-tools.ts");
});

test("completion port uses the host executable/profile and the caller's selected model and cap", async () => {
  clearConfiguration();
  const root = await mkdtemp(join(tmpdir(), "chrona-pi-host-")); roots.push(root);
  const profile = join(root, "profile"), record = join(root, "request.json"), command = join(root, "pi");
  await mkdir(profile, { mode: 0o700 });
  await writeFile(command, `#!${process.execPath}
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("1.5.0"); process.exit(0); }
let prompt = ""; for await (const chunk of process.stdin) prompt += chunk.toString();
const hooks = new Map();
(await import(pathToFileURL(args[args.indexOf("-e") + 1]).href)).default({ on: (name, handler) => hooks.set(name, handler) });
const payload = hooks.get("before_provider_request")({ payload: { max_completion_tokens: 100 } }, { model: { provider: "fake", id: "selected", api: "openai-completions" } });
writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, prompt, payload, profile: process.env.PI_CODING_AGENT_DIR }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", provider: "fake", model: "selected", stopReason: "stop", content: [{ type: "text", text: "host completion" }], usage: { input: 3, output: 7 } } }));
`, { mode: 0o755 });
  process.env.CHRONA_STEWARD_PI_COMMAND = command;
  process.env.CHRONA_STEWARD_PI_AGENT_DIR = profile;
  process.env.CHRONA_STEWARD_PI_VERSION = "1.5.0";
  process.env.CHRONA_STEWARD_PI_MODEL = "fake/host-default";
  const gateway = createPiModelGateway({ port: 3123, dataDir: join(root, "data") });
  expect(await gateway.complete({ model: "fake/selected", prompt: "literal prompt", maxOutputTokens: 9, timeoutMs: 2000 })).toEqual({ text: "host completion", inputTokens: 3, outputTokens: 7 });
  const request = JSON.parse(await readFile(record, "utf8"));
  expect(request.profile).toBe(profile);
  expect(request.payload.max_completion_tokens).toBe(9);
  expect(request.args.slice(request.args.indexOf("--model"), request.args.indexOf("--model") + 2)).toEqual(["--model", "fake/selected"]);
  expect(request.prompt).toBe("literal prompt");
});

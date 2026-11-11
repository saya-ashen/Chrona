import { afterEach, expect, test } from "bun:test";

import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { piHostConfiguration } from "./pi-model-gateway";
import { createPiApplicationHost } from "./agent-application-host";

const keys = ["CHRONA_RESOURCE_DIR", "CHRONA_STEWARD_PI_COMMAND", "CHRONA_STEWARD_PI_AGENT_DIR", "CHRONA_STEWARD_PI_MODEL", "CHRONA_STEWARD_PI_VERSION", "CHRONA_STEWARD_PI_RESOURCES_FILE", "CHRONA_STEWARD_PI_WEB_EXTENSION", "CHRONA_STEWARD_EXECUTION_MODE", "CHRONA_STEWARD_SANDBOX_BWRAP", "CHRONA_STEWARD_BROWSER"] as const;
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const roots: string[] = [];
afterEach(async () => {
  for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function clearConfiguration() { for (const key of keys) delete process.env[key]; }

test("host configuration resolves Pi resources in source and release layouts", () => {
  clearConfiguration();
  const source = piHostConfiguration({ port: 3123, dataDir: "/host/data" });
  expect(source.chronaExtension).toBe(resolve("packages/pi/resources/chrona-tools.ts"));
  expect(existsSync(source.chronaExtension)).toBe(true);
  expect(existsSync(source.browserExtension!)).toBe(true);
  expect(source.agentUrl).toBe("http://127.0.0.1:3123/api/steward-agent");
  expect(source.agentDir).toBeUndefined();
  process.env.CHRONA_RESOURCE_DIR = "/release/resources";
  const release = piHostConfiguration({ port: 3123, dataDir: "/host/data" });
  expect(release.chronaExtension).toBe("/release/resources/pi/chrona-tools.ts");
  expect(release.browserExtension).toBe("/release/resources/pi/browser-tools.ts");
});

test("Pi host keeps profile and resource selection in module configuration", async () => {
  clearConfiguration();
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-pi-host-")); roots.push(dataDir);
  process.env.CHRONA_STEWARD_PI_COMMAND = "/fixture/pi";
  process.env.CHRONA_STEWARD_PI_AGENT_DIR = "/fixture/profile";
  process.env.CHRONA_STEWARD_PI_VERSION = "1.5.0";
  process.env.CHRONA_STEWARD_PI_MODEL = "fake/host-default";
  process.env.CHRONA_STEWARD_PI_RESOURCES_FILE = "/fixture/resources.json";
  const config = piHostConfiguration({ port: 3123, dataDir });
  expect(config).toMatchObject({ command: "/fixture/pi", agentDir: "/fixture/profile", expectedVersion: "1.5.0", model: "fake/host-default", resourcesFile: "/fixture/resources.json", workspaceRoot: join(dataDir, "sessions") });
  process.env.CHRONA_STEWARD_BROWSER = "/fixture/browser";
  const host = createPiApplicationHost({ port: 3123, dataDir });
  expect(JSON.parse(host.env.CHRONA_PROVIDER_CONFIGURATION)).toEqual(JSON.parse(JSON.stringify(config)));
  expect(host.env.CHRONA_STEWARD_BROWSER).toBe("/fixture/browser");
});

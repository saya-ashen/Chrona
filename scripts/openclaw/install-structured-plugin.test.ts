import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("openclaw structured plugin install command", () => {
  it("installation script exists and plugin package is wired", () => {
    const scriptPath = resolve(process.cwd(), "scripts/openclaw/install-structured-plugin.ts");
    const pluginPkg = resolve(process.cwd(), "packages/openclaw-plugin-structured-result/package.json");
    const pluginEntry = resolve(process.cwd(), "packages/openclaw-plugin-structured-result/src/index.ts");

    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(pluginPkg)).toBe(true);
    expect(existsSync(pluginEntry)).toBe(true);
  });
});

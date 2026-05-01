import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("openclaw structured plugin install command", () => {
  it("installation script exists and plugin package is wired", () => {
    const scriptPath = resolve(process.cwd(), "scripts/openclaw/install-structured-plugin.ts");
    const pluginEntry = resolve(process.cwd(), "packages/providers/openclaw/integration/src/protocol/structured-result.ts");

    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(pluginEntry)).toBe(true);
  });
});

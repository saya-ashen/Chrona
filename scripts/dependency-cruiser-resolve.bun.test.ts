import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import enhancedResolve from "enhanced-resolve";
import configuration from "../.dependency-cruiser-resolve.cjs";

const resolvePackage = enhancedResolve.create.sync({
  ...configuration.resolve,
  extensions: [".ts", ".js", ".json"],
  exportsFields: ["exports"],
  conditionNames: ["import", "node", "default", "types"],
});

test("boundary resolution uses the declared local version and public exports before host aliases", () => {
  const root = mkdtempSync(join(tmpdir(), "chrona-boundary-resolve-"));
  const consumer = join(root, "consumer"), dependency = join(root, "vendor/domain@2");
  function file(path: string, value: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); }
  try {
    file(join(consumer, "package.json"), JSON.stringify({ name: "consumer", dependencies: { "@chrona/domain": "file:../vendor/domain@2", "@chrona/pi": "file:../missing-pi" } }));
    file(join(dependency, "package.json"), JSON.stringify({ name: "@chrona/domain", version: "2.0.0", exports: { ".": "./src/index.ts", "./steward/*": "./src/steward/*.ts" } }));
    file(join(dependency, "src/index.ts"), "export {};\n");
    file(join(dependency, "src/steward/provider.ts"), "export {};\n");
    file(join(dependency, "src/private.ts"), "export {};\n");
    expect(resolvePackage(consumer, "@chrona/domain")).toBe(join(dependency, "src/index.ts"));
    expect(resolvePackage(consumer, "@chrona/domain/steward/provider")).toBe(join(dependency, "src/steward/provider.ts"));
    expect(() => resolvePackage(consumer, "@chrona/domain/src/private.ts")).toThrow("not exported");
    expect(() => resolvePackage(consumer, "@chrona/pi")).toThrow("Cannot resolve declared local dependency");
    expect(resolvePackage(resolve("packages/pi/src"), "@chrona/domain/steward/provider")).toBe(resolve("packages/domain/src/steward/provider.ts"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

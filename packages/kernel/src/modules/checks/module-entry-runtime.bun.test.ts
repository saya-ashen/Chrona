import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { installDependencies } from "./module-dependencies";
import { typecheckBuild } from "./module-typecheck";
import type { ModuleContext } from "../module-context";

test("explicit entry runtime is included in host-program preflight even without library dependencies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chrona-entry-dependencies-"));
  const inputs: unknown[] = [];
  const context = { db: {}, ports: { packages: { install: async (input: unknown) => {
    inputs.push(input);
    return { errors: ["Required host program unavailable: java"], installed: { npm: false, python: false, packages: {} } };
  } } } } as unknown as ModuleContext;
  try {
    const manifest = moduleManifestSchema.parse({ name: "probe", keepAlive: true, entry: { path: "dist/app.jar", runtime: "java", args: ["-jar"] }, tests: ["test.ts"], effects: [] });
    expect(await installDependencies(context, dir, manifest)).toMatchObject({ errors: ["Required host program unavailable: java"] });
    expect(inputs).toEqual([{ dir, packages: ["java"] }]);
    expect(await installDependencies(context, dir, { ...manifest, entry: { path: "dist/native", args: [] } })).toBeNull();
    expect(await installDependencies({ ...context, ports: {} } as ModuleContext, dir, manifest)).toMatchObject({ errors: ["Dependency installation is not available on this host"] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("explicit native and interpreter entries skip extension-inferred type checks", async () => {
  const context = { db: {}, ports: { moduleRuntimes: { version: 1, runtimes: [{ extensions: [".ts"], check: { programs: { default: ["unavailable"] }, argv: [] } }] } } } as unknown as ModuleContext;
  for (const entry of [{ path: "dist/app.ts" }, { path: "dist/app.ts", runtime: "bun" }, { path: "dist/app.jar", runtime: "java", args: ["-jar"] }]) {
    const manifest = moduleManifestSchema.parse({ name: "probe", keepAlive: true, entry, tests: ["test.ts"], effects: [] });
    expect(await typecheckBuild(context, "/unused-fixture", manifest)).toEqual({ status: "skipped", reason: "runtime has no declared check" });
  }
});

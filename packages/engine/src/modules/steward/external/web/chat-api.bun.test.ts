import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createScriptSandbox } from "../../../../../../integrations/src/steward/script-sandbox";

// Real Web HTTP routes and SDK test peer; stubs never reach a model, database or remote service.
test("Web chat HTTP preserves terminal failure and exact explicit continuation identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-entry-api-"));
  try {
    const dataDir = join(root, "data"), contentDir = join(root, "content"); await mkdir(dataDir); await mkdir(contentDir);
    const sandbox = createScriptSandbox({ executionMode: "trusted-local", dataDir: root,
      moduleSdk: resolve(import.meta.dir, "../../../../../../integrations/src/steward/module-sdk") });
    const result = await sandbox.runModule({ codeDir: import.meta.dir, dataDir, contentDir, entry: "test.ts", input: {}, timeoutMs: 30_000 });
    expect(result, [result.error, result.output].filter(Boolean).join("\n")).toMatchObject({ status: "succeeded", exitCode: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 40_000);

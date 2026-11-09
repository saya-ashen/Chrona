import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createScriptSandbox } from "../../../../../../integrations/src/steward/script-sandbox";

test("shipped SDK tool and HTTP entry share durable receipts in the offline author harness", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coding-entry-"));
  try {
    const dataDir = join(dir, "module-data"); await mkdir(dataDir);
    const sandbox = createScriptSandbox({ dataDir: dir, executionMode: "trusted-local" });
    const result = await sandbox.runModule({ codeDir: import.meta.dir, dataDir, entry: "test.ts", input: "", network: false, timeoutMs: 15_000 });
    expect({ status: result.status, exitCode: result.exitCode, error: result.error, output: result.output }).toEqual({ status: "succeeded", exitCode: 0, error: null, output: "" });
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 20_000);

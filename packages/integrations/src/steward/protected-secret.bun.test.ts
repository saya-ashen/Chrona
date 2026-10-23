import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProtectedSecret } from "./protected-secret";

test("secret file must be private and owned; content is returned only to the caller", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qq-secret-"));
  try {
    const file = join(dir, "s"); writeFileSync(file, "synthetic-secret\n", { mode: 0o644 });
    await expect(readProtectedSecret(file)).rejects.toThrow("private");
    chmodSync(file, 0o600);
    expect(await readProtectedSecret(file)).toBe("synthetic-secret");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

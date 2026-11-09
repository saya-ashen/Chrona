import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Journal } from "./journal";

test("hot rollback journal symlink is rejected before SQLite recovery touches its target", () => {
  const root = mkdtempSync(join(tmpdir(), "chrona-private-journal-")); chmodSync(root, 0o700);
  const outside = join(root, "retained-proof"), original = Buffer.from("retained unrelated evidence");
  try {
    const journal = new Journal(root); journal.close();
    writeFileSync(outside, original, { mode: 0o600 });
    symlinkSync(outside, join(root, "journal.sqlite-journal"));
    expect(() => new Journal(root)).toThrow();
    expect(readFileSync(outside).equals(original)).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

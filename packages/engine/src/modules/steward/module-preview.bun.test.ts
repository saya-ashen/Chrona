import { expect, test } from "bun:test";
import { codeDifference, compactDiff } from "./module-preview";

test("binary files show their size, not their bytes", async () => {
  const diff = await codeDifference("/nonexistent", null, [{ path: "__pycache__/main.pyc", bytes: Buffer.from([0x6f, 0x0d, 0x00, 0xff]) }, { path: "main.py", bytes: Buffer.from("print('hi')\n") }]);
  expect(diff).toContain("=== __pycache__/main.pyc (added) ===\n（二进制文件：0 → 4 字节）");
  expect(diff).toContain("+ print('hi')");
});

// v2-22: a manifest review shows what changes, so a group of large manifests still fits one approval.
test("compactDiff keeps changed lines with context and folds the rest", () => {
  const before = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
  const after = before.replace("line 10", "line ten");
  expect(compactDiff(before, after)).toEqual(["  …（8 行未变）", "  line 8", "  line 9", "- line 10", "+ line ten", "  line 11", "  line 12", "  …（7 行未变）"]);
  expect(compactDiff("", "a\nb")).toEqual(["+ a", "+ b"]);
  expect(compactDiff(before, before)).toEqual(["  …（20 行未变）"]);
});

import { expect, test } from "bun:test";
import { codeDifference } from "./module-preview";

test("binary files show their size, not their bytes", async () => {
  const diff = await codeDifference("/nonexistent", null, [{ path: "__pycache__/main.pyc", bytes: Buffer.from([0x6f, 0x0d, 0x00, 0xff]) }, { path: "main.py", bytes: Buffer.from("print('hi')\n") }]);
  expect(diff).toContain("=== __pycache__/main.pyc (added) ===\n（二进制文件：0 → 4 字节）");
  expect(diff).toContain("+ print('hi')");
});

import { expect, test } from "bun:test";
import { moduleEntrySchema } from "./module-entry";

test("module entries retain script shorthand and explicit native/interpreter argv", () => {
  for (const entry of ["main.ts", "test.py", "run.sh"]) expect(moduleEntrySchema.parse(entry)).toBe(entry);
  expect(moduleEntrySchema.parse({ path: "dist/native" })).toEqual({ path: "dist/native", args: [] });
  expect(moduleEntrySchema.parse({ path: "dist/app.jar", runtime: "java", args: ["-jar"] })).toEqual({ path: "dist/app.jar", runtime: "java", args: ["-jar"] });
  expect(moduleEntrySchema.parse({ path: "dist/native", args: ["", "--option=value", "$(echo literal)", "a b"] })).toEqual({ path: "dist/native", args: ["", "--option=value", "$(echo literal)", "a b"] });
});

test("explicit entry validation bounds argv and rejects unsafe paths and runtime commands", () => {
  for (const path of ["", "/bin/app", "C:/app.exe", "./app", "../app", "dist/../app", "dist/./app", "dist//app", "dist/", ".git/app", "dist/.GIT/app", "dist\\app", "dist/a\0b", "x".repeat(1025)]) {
    expect(moduleEntrySchema.safeParse({ path }).success).toBe(false);
  }
  for (const runtime of ["", "/bin/java", "./java", "../java", "java -jar", "sh;echo", "a\0b", "x".repeat(129)]) {
    expect(moduleEntrySchema.safeParse({ path: "dist/app", runtime }).success).toBe(false);
  }
  for (const args of [["x\0y"], ["x".repeat(2049)], Array(33).fill("")]) expect(moduleEntrySchema.safeParse({ path: "dist/app", args }).success).toBe(false);
  expect(moduleEntrySchema.safeParse({ path: "dist/app", extra: true }).success).toBe(false);
  expect(moduleEntrySchema.safeParse({ path: "dist/app", args: Array(32).fill("x".repeat(2048)) }).success).toBe(true);
  for (const entry of ["nested/main.ts", "main.js", "main", "main.ts --flag"]) expect(moduleEntrySchema.safeParse(entry).success).toBe(false);
});

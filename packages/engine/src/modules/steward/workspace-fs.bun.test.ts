import { expect, test } from "bun:test";
import { appendFile, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceFs } from "./workspace-fs";

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "chrona-workspace-fs-"));
  const workspace = createWorkspaceFs(dataDir);
  const files = await workspace.createAffairDir("affair-1", "# Study\n\nFirst paragraph.\n\n- [ ] Read\n");
  return { dataDir, workspace, files, dir: join(dataDir, "affairs", "affair-1") };
}
test("create, read, tree, save, conflict and authors", async () => {
  const { files, dir } = await fixture();
  const readme = await files.read("README.md");
  expect(readme.content).toContain("First paragraph.");
  expect(readme.revision).toMatch(/^[a-f0-9]{40}$/);
  expect((await files.revisions())[0]?.author).toBe("chrona");
  expect(await readFile(join(dir, ".chrona/.gitignore"), "utf8")).toBe("sessions/\n");
  const saved = await files.save("README.md", "Changed\n", readme.revision);
  expect(saved.revision).not.toBe(readme.revision);
  await expect(files.save("README.md", "Lost\n", readme.revision)).rejects.toMatchObject({ code: "conflict" });
  expect((await files.revisions())[0]?.author).toBe("user");
  await files.save("pages/day.md", "Day one", null);
  await mkdir(join(dir, ".chrona/sessions"));
  await writeFile(join(dir, ".chrona/sessions/private.json"), "private");
  expect((await files.tree()).map(row => row.path)).toEqual([".chrona", ".chrona/.gitignore", "pages", "pages/day.md", "README.md"].sort((a, b) => a.localeCompare(b)));
  expect(await files.commitAll("chrona", "No change")).toEqual([]);
});
test("concurrent saves serialize; unrelated commits do not cause file conflicts", async () => {
  const { files } = await fixture();
  const before = await files.read("README.md");
  await files.save("other.txt", "other", null);
  const results = await Promise.allSettled([files.save("README.md", "one", before.revision), files.save("README.md", "two", before.revision)]);
  expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
});
test("uncommitted provider changes are not silently overwritten", async () => {
  const { files, dir } = await fixture();
  const before = await files.read("README.md");
  await writeFile(join(dir, "README.md"), "Provider update");
  await expect(files.save("README.md", "User update", before.revision)).rejects.toMatchObject({ code: "conflict" });
  expect(await files.commitAll("chrona", "Provider update")).toEqual(["README.md"]);
});
test("checkbox and panel append use domain helpers and commit", async () => {
  const { files } = await fixture();
  const before = await files.read("README.md");
  expect((await files.toggleCheckbox("README.md", 5, true, before.revision)).content).toContain("- [x] Read");
  const fields = [{ key: "note", label: "Note", type: "text" as const, required: true }];
  await files.appendPanelEntry("data/log.csv", fields, { note: "first" });
  await files.appendPanelEntry("data/log.csv", fields, { note: 'second,"quoted"' });
  expect((await files.read("data/log.csv")).content).toBe('note\nfirst\n"second,""quoted"""\n');
  await expect(files.appendPanelEntry("data/log.csv", fields, { unknown: 3 })).rejects.toThrow();
  expect(await files.revisions("data/log.csv")).toHaveLength(2);
});
test("upload sanitizes name, handles binary, caps size, refuses overwrite", async () => {
  const { files } = await fixture();
  const result = await files.upload("materials", "../../hello world.png", new Uint8Array([137, 80, 78, 71, 0]));
  expect(result.path).toBe("materials/hello_world.png");
  expect(await files.read(result.path)).toMatchObject({ content: "", mime: "image/png" });
  await expect(files.upload("materials", "hello_world.png", new Uint8Array())).rejects.toThrow();
  await expect(files.upload("", "large.bin", new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: "invalid" });
  await expect(files.upload("../", "x", new Uint8Array())).rejects.toThrow();
});
test("revision filtering, diff, revert, conflict recovery", async () => {
  const { files } = await fixture();
  const before = await files.read("README.md");
  const after = await files.save("README.md", "New content\n", before.revision);
  expect(await files.diff(after.revision!)).toContain("+New content");
  const reverted = await files.revert(after.revision!);
  expect(reverted.author).toBe("user");
  expect((await files.read("README.md")).content).toBe(before.content);
  const one = await files.save("README.md", "first\n", reverted.sha);
  await files.save("README.md", "second\n", one.revision);
  await expect(files.revert(one.revision!)).rejects.toMatchObject({ code: "conflict" });
  expect((await files.read("README.md")).content).toBe("second\n");
  expect(await files.commitAll("chrona", "Clean after conflict")).toEqual([]);
  await expect(files.diff("--output=/tmp/escape")).rejects.toThrow();
});
test.each(["../outside", "/tmp/outside", ".git/config", "x/../../outside", "a\\b", ".chrona/sessions/private", "./README.md", "x\0y"])("reject path %s", async path => {
  const { files } = await fixture();
  await expect(files.read(path)).rejects.toThrow();
  await expect(files.save(path, "bad", null)).rejects.toThrow();
});
test("reject directory/file/root symlinks and do not follow them in tree", async () => {
  const { dataDir, files, workspace, dir } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "chrona-outside-"));
  await writeFile(join(outside, "secret"), "untouched");
  await symlink(outside, join(dir, "escape"));
  await symlink(join(outside, "secret"), join(dir, "secret"));
  await symlink(outside, join(dataDir, "affairs", "other"));
  await expect(files.read("escape/secret")).rejects.toMatchObject({ code: "forbidden" });
  await expect(files.save("secret", "bad", null)).rejects.toMatchObject({ code: "forbidden" });
  await expect(files.upload("escape", "new", new Uint8Array())).rejects.toThrow();
  await expect(workspace.forAffair("other").read("secret")).rejects.toThrow();
  expect((await files.tree()).some(row => row.path.startsWith("escape") || row.path === "secret")).toBe(false);
  expect(await readFile(join(outside, "secret"), "utf8")).toBe("untouched");
  expect(() => workspace.forAffair("../outside")).toThrow();
});
test("git pathspec metacharacters are literal filenames", async () => {
  const { files } = await fixture();
  await files.save("notes[1].txt", "literal", null);
  await files.save("notes1.txt", "other", null);
  expect((await files.read("notes[1].txt")).content).toBe("literal");
  expect(await files.revisions("notes[1].txt")).toHaveLength(1);
  expect((await files.revisions("notes[1].txt"))[0]?.paths).toEqual(["notes[1].txt"]);
});
test("git refuses metadata symlinks, alternate stores and config includes", async () => {
  const first = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "chrona-git-outside-"));
  await symlink(outside, join(first.dir, ".git/unsafe"));
  await expect(first.files.revisions()).rejects.toMatchObject({ code: "forbidden" });
  const second = await fixture();
  await writeFile(join(second.dir, ".git/objects/info/alternates"), outside);
  await expect(second.files.commitAll("chrona", "unsafe")).rejects.toMatchObject({ code: "forbidden" });
  const third = await fixture();
  await appendFile(join(third.dir, ".git/config"), `\n[include]\npath = ${outside}/config\n`);
  await expect(third.files.revisions()).rejects.toMatchObject({ code: "forbidden" });
});
test("git ignores inherited GIT environment and never runs local hooks", async () => {
  const { files, dir } = await fixture();
  const marker = join(dir, "hook-ran");
  await mkdir(join(dir, ".git/hooks"));
  await writeFile(join(dir, ".git/hooks/pre-commit"), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
  const before = await files.read("README.md");
  const old = Bun.env.GIT_DIR;
  Bun.env.GIT_DIR = "/nonexistent/hostile-git-dir";
  try { await files.save("README.md", "safe", before.revision); }
  finally { if (old === undefined) delete Bun.env.GIT_DIR; else Bun.env.GIT_DIR = old; }
  expect(await Bun.file(marker).exists()).toBe(false);
});

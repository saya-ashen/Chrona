import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createBrowsers } from "./browser";

const cleanups: string[] = [];
afterEach(async () => { for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function temp() { const dir = await mkdtemp(join(tmpdir(), "chrona-browser-")); cleanups.push(dir); return dir; }
const program = (name: string) => process.platform === "win32" ? `${name}.exe` : name;
async function executable(path: string) { await writeFile(path, "browser fixture", { mode: 0o755 }); return realpathSync(path); }

test("an explicit browser comes first, then host PATH with its native delimiter", async () => {
  const root = await temp(), bin = join(root, "bin"), empty = join(root, "empty");
  await mkdir(bin); await mkdir(empty);
  const onPath = await executable(join(bin, program("google-chrome"))), configured = await executable(join(root, program("my-chrome")));
  const path = [empty, bin].join(delimiter);
  const which = spyOn(Bun, "which");
  try {
    expect(createBrowsers({ configured, path }).find()).toBe(configured);
    expect(which).not.toHaveBeenCalled();
    expect(createBrowsers({ configured: join(root, "missing"), path }).find()).toBe(onPath);
    expect(createBrowsers({ path: empty }).find()).toBeNull();
  } finally { which.mockRestore(); }
});

test("missing browsers stay unavailable without acquisition, and an owner installation is found later", async () => {
  const root = await temp(), browsers = createBrowsers({ path: root });
  // Installed acquisition tools must not be invoked when no browser is present.
  await executable(join(root, program("nix")));
  await executable(join(root, program("unzip")));
  const fetcher = spyOn(globalThis, "fetch").mockImplementation((async () => { throw new Error("Unexpected browser download"); }) as unknown as typeof fetch);
  try {
    const before = await readdir(root);
    expect(browsers.ensure()).toBeNull();
    expect(browsers.ensure()).toBeNull();
    await Promise.resolve();
    expect(await readdir(root)).toEqual(before);
    expect(fetcher).not.toHaveBeenCalled();
    const browser = await executable(join(root, program("chromium")));
    expect(browsers.ensure()).toBe(browser);
  } finally { fetcher.mockRestore(); }
});

test("directories and non-executables are not browsers", async () => {
  const root = await temp(), bin = join(root, "bin");
  await mkdir(bin);
  expect(createBrowsers({ configured: root, path: bin }).ensure()).toBeNull();
  if (process.platform !== "win32") {
    const file = join(root, "plain-file");
    await writeFile(file, "", { mode: 0o600 });
    expect(createBrowsers({ configured: file, path: bin }).ensure()).toBeNull();
  }
});

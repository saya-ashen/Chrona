import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowsers } from "./browser";

const cleanups: string[] = [];
afterEach(async () => { for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function temp() { const dir = await mkdtemp(join(tmpdir(), "chrona-browser-")); cleanups.push(dir); return dir; }
async function executable(path: string, body = "#!/bin/sh\nexit 0\n") { await writeFile(path, body, { mode: 0o755 }); return realpathSync(path); }

test("an explicit browser comes first, then PATH; nothing found is null", async () => {
  const root = await temp(), bin = join(root, "bin");
  await mkdir(bin);
  const onPath = await executable(join(bin, "google-chrome")), configured = await executable(join(root, "my-chrome"));
  const dir = join(root, "acquired");
  expect(createBrowsers({ configured, dir, path: bin }).find()).toBe(configured);
  expect(createBrowsers({ configured: join(root, "missing"), dir, path: bin }).find()).toBe(onPath);
  expect(createBrowsers({ dir, path: "" }).find()).toBeNull();
});

test("with Nix, a missing browser is built once into Chrona's directory and found by later runs", async () => {
  const root = await temp(), dir = join(root, "acquired"), log = join(root, "nix.log");
  // A fake `nix build --out-link <link> ...`: the link points at a store-like directory with bin/chromium.
  const nix = await executable(join(root, "nix"), `#!/bin/sh
echo "$@" >> ${log}
while [ "$1" != "--out-link" ]; do shift; done
mkdir -p "$2.out/bin" && printf '#!/bin/sh\\n' > "$2.out/bin/chromium" && chmod +x "$2.out/bin/chromium" && ln -s "$2.out" "$2"
`);
  const browsers = createBrowsers({ dir, path: "", nix, nixpkgs: "github:NixOS/nixpkgs/abc" });
  expect(browsers.ensure()).toBeNull();
  expect(browsers.ensure()).toBeNull();
  await browsers.settled();
  expect(browsers.ensure()).toBe(join(dir, "nix.out", "bin", "chromium"));
  const calls = (await readFile(log, "utf8")).trim().split("\n");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("github:NixOS/nixpkgs/abc#chromium");
});

test("without Nix, the pinned archive is downloaded, checked and unpacked; a mismatch is reported once and never retried", async () => {
  const root = await temp(), source = join(root, "source", "chrome-headless-shell-linux64");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "chrome-headless-shell"), "#!/bin/sh\n");
  // python3 writes the archive without the executable bit, like the real download unpacked by python3.
  const zip = join(root, "shell.zip");
  expect(spawnSync("python3", ["-I", "-m", "zipfile", "-c", zip, "chrome-headless-shell-linux64"], { cwd: join(root, "source") }).status).toBe(0);
  const bytes = await readFile(zip), sha256 = createHash("sha256").update(bytes).digest("hex");
  const pinned = { version: "1.0.0", sha256, url: "https://example.invalid/shell.zip" };
  const errors: string[] = [], downloads: string[] = [];
  const download = async (url: string) => { downloads.push(url); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); };

  const wrong = createBrowsers({ dir: join(root, "wrong"), path: "", nix: null, download, pinned: { ...pinned, sha256: "0".repeat(64) }, onError: error => errors.push(error) });
  wrong.ensure(); await wrong.settled();
  wrong.ensure(); await wrong.settled();
  expect(errors).toEqual(["Browser download does not match the pinned SHA-256"]);
  expect(downloads).toHaveLength(1);
  expect(wrong.find()).toBeNull();

  const browsers = createBrowsers({ dir: join(root, "ok"), path: "", nix: null, download, pinned, onError: error => errors.push(error) });
  expect(browsers.ensure()).toBeNull();
  await browsers.settled();
  const found = browsers.find()!;
  expect(found).toBe(join(root, "ok", "1.0.0", "chrome-headless-shell-linux64", "chrome-headless-shell"));
  expect((await stat(found)).mode & 0o111).not.toBe(0);
  expect(downloads).toEqual([pinned.url, pinned.url]);
  expect(errors).toHaveLength(1);
});

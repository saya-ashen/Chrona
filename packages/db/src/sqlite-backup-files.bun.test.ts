import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "bun:test";

import { backupDataFiles, backupDataRoots, stageDataFiles } from "./sqlite-backup-files";

function fixture(run: (directory: string, data: string, archive: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "chrona-ustar-"));
  try {
    const data = join(directory, "data");
    mkdirSync(data);
    run(directory, data, join(directory, "backup.tar"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function sourceFile(data: string, path: string, content: string | Buffer = "saved"): void {
  mkdirSync(dirname(join(data, path)), { recursive: true });
  writeFileSync(join(data, path), content);
}

describe("in-process restricted ustar backup", () => {
  it("round trips binary data across block and copy-buffer boundaries, executable files and empty directories", () => {
    fixture((_directory, data, archive) => {
      const sizes = [0, 1, 511, 512, 513, 65535, 65536, 65537];
      for (const size of sizes) sourceFile(data, `sessions/size-${size}`, Buffer.from(Array.from({ length: size }, (_, i) => i % 256)));
      sourceFile(data, "platform/run.sh", "#!/bin/sh\n");
      if (process.platform !== "win32") chmodSync(join(data, "platform/run.sh"), 0o755);
      mkdirSync(join(data, "secrets/empty/nested"), { recursive: true });
      expect(backupDataFiles(data, archive)).toEqual([]);
      const stage = stageDataFiles(join(data, "restore"), archive);
      for (const size of sizes) expect(readFileSync(join(stage, `sessions/size-${size}`))).toEqual(readFileSync(join(data, `sessions/size-${size}`)));
      expect(statSync(join(stage, "secrets/empty/nested")).isDirectory()).toBe(true);
      expect(readFileSync(join(stage, "platform/run.sh"), "utf8")).toBe("#!/bin/sh\n");
      if (process.platform !== "win32") {
        expect(statSync(archive).mode & 0o777).toBe(0o600);
        expect(statSync(join(stage, "sessions/size-513")).mode & 0o777).toBe(0o600);
        expect(statSync(join(stage, "platform/run.sh")).mode & 0o777).toBe(0o700);
        expect(statSync(join(stage, "secrets/empty/nested")).mode & 0o777).toBe(0o700);
      }
    });
  });

  it.skipIf(process.platform === "win32")("works without tar on PATH and keeps generated files private under a permissive umask", () => {
    fixture((_directory, data, archive) => {
      sourceFile(data, "secrets/value", "private");
      const oldPath = process.env.PATH, oldMask = process.umask(0);
      try {
        process.env.PATH = "";
        backupDataFiles(data, archive);
        const stage = stageDataFiles(join(data, "restore"), archive);
        expect(readFileSync(join(stage, "secrets/value"), "utf8")).toBe("private");
        expect(statSync(archive).mode & 0o777).toBe(0o600);
        expect(statSync(join(stage, "secrets/value")).mode & 0o777).toBe(0o600);
        expect(statSync(join(stage, "secrets")).mode & 0o777).toBe(0o700);
      } finally {
        if (oldPath === undefined) delete process.env.PATH;
        else process.env.PATH = oldPath;
        process.umask(oldMask);
      }
    });
  });

  it("writes an empty archive that restores all absent roots as empty directories", () => {
    fixture((_directory, data, archive) => {
      backupDataFiles(data, archive);
      expect(readFileSync(archive)).toEqual(Buffer.alloc(1024));
      const stage = stageDataFiles(join(data, "restore"), archive);
      for (const root of backupDataRoots) expect(statSync(join(stage, root)).isDirectory()).toBe(true);
    });
  });

  it("stores hard-linked files as independent regular files, including links to files outside the data roots", () => {
    fixture((directory, data, archive) => {
      const outside = join(directory, "outside");
      writeFileSync(outside, "saved");
      for (const root of backupDataRoots) {
        mkdirSync(join(data, root));
        linkSync(outside, join(data, root, "copy"));
      }
      backupDataFiles(data, archive);
      const stage = stageDataFiles(join(data, "restore"), archive);
      for (const root of backupDataRoots) {
        const restored = join(stage, root, "copy");
        expect(lstatSync(restored).isFile()).toBe(true);
        expect(statSync(restored).nlink).toBe(1);
        expect(readFileSync(restored, "utf8")).toBe("saved");
      }
      writeFileSync(join(stage, "platform/copy"), "changed");
      expect(readFileSync(join(stage, "secrets/copy"), "utf8")).toBe("saved");
      expect(readFileSync(outside, "utf8")).toBe("saved");
    });
  });

  const maxPrefix = `platform/${"p".repeat(70)}/${"q".repeat(75)}`;
  it.each([
    `sessions/${"a".repeat(91)}`, // Exactly 100 bytes with no prefix needed.
    `sessions/${"a".repeat(100)}`,
    `sessions/${"é".repeat(50)}`,
    `${maxPrefix}/${"a".repeat(100)}`, // Both fields filled: 155 + slash + 100 bytes.
    `${maxPrefix}/${"é".repeat(50)}`,
    `platform/${"é".repeat(35)}/${"q".repeat(75)}/${"a".repeat(100)}`,
    `sessions/${"a".repeat(90)}/${"b".repeat(56)}/x`, // The last slash cannot be the prefix/name split.
    "sessions/line\nbreak",
  ])("round trips representable ustar paths: %s", path => {
    fixture((_directory, data, archive) => {
      sourceFile(data, path);
      backupDataFiles(data, archive);
      const stage = stageDataFiles(join(data, "restore"), archive);
      expect(readFileSync(join(stage, path), "utf8")).toBe("saved");
    });
  });

  it("round trips an empty directory using both full ustar path fields", () => {
    fixture((_directory, data, archive) => {
      const path = `${maxPrefix}/${"é".repeat(50)}`;
      mkdirSync(join(data, path), { recursive: true });
      backupDataFiles(data, archive);
      const stage = stageDataFiles(join(data, "restore"), archive);
      expect(statSync(join(stage, path)).isDirectory()).toBe(true);
    });
  });

  it.each([
    `sessions/${"a".repeat(101)}`,
    `sessions/${"é".repeat(51)}`,
    `${maxPrefix}q/${"a".repeat(100)}`,
  ])("rejects unrepresentable ustar paths without leaving an archive: %s", path => {
    fixture((_directory, data, archive) => {
      sourceFile(data, path);
      expect(() => backupDataFiles(data, archive)).toThrow("ustar limits");
      expect(existsSync(archive)).toBe(false);
      expect(readFileSync(join(data, path), "utf8")).toBe("saved");
    });
  });

  it.skipIf(process.platform === "win32")("refuses source names that the restore path validator rejects", () => {
    fixture((_directory, data, archive) => {
      sourceFile(data, "sessions/back\\slash");
      expect(() => backupDataFiles(data, archive)).toThrow("unsafe backup path");
      expect(existsSync(archive)).toBe(false);
    });
  });

  it.skipIf(process.platform !== "linux")("rejects sizes beyond the 11-octal-digit ustar field and removes the partial output", () => {
    fixture((_directory, data, archive) => {
      sourceFile(data, "sessions/too-large", "");
      truncateSync(join(data, "sessions/too-large"), 0o100000000000);
      expect(() => backupDataFiles(data, archive)).toThrow("ustar size limits");
      expect(existsSync(archive)).toBe(false);
    });
  });

  it("never overwrites an existing archive", () => {
    fixture((_directory, data, archive) => {
      writeFileSync(archive, "keep");
      expect(() => backupDataFiles(data, archive)).toThrow("already exists");
      expect(readFileSync(archive, "utf8")).toBe("keep");
    });
  });

  it.skipIf(process.platform === "win32")("refuses a dangling symlink at the output path without writing its target", () => {
    fixture((directory, data, archive) => {
      const target = join(directory, "missing");
      symlinkSync(target, archive);
      expect(() => backupDataFiles(data, archive)).toThrow();
      expect(lstatSync(archive).isSymbolicLink()).toBe(true);
      expect(existsSync(target)).toBe(false);
    });
  });
});

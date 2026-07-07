import { mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";

import { hydrateFilePreviewSpec, resolveFilePreview } from "./file-preview";

async function withTempDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "chrona-file-preview-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("resolveFilePreview", () => {
  it("reads markdown previews under the root", async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, "report.md"), "# Report\n\nBody");

      const preview = await resolveFilePreview("report.md", { rootDir: dir });

      expect(preview).toMatchObject({
        displayPath: "report.md",
        contentKind: "markdown",
        contentPreview: "# Report\n\nBody",
        contentBytes: 14,
        contentTruncated: false,
      });
    });
  });

  it("rejects traversal and secret-like paths before reading", async () => {
    await withTempDir(async (dir) => {
      expect(await resolveFilePreview("../secret.md", { rootDir: dir })).toMatchObject({ previewError: "unsafe_path" });
      expect(await resolveFilePreview(".env", { rootDir: dir })).toMatchObject({ previewError: "unsafe_path" });
    });
  });

  it("rejects symlink escapes", async () => {
    await withTempDir(async (dir) => {
      const outside = await mkdtemp(join(tmpdir(), "chrona-file-preview-outside-"));
      try {
        await Bun.write(join(outside, "outside.md"), "outside");
        await symlink(join(outside, "outside.md"), join(dir, "link.md"));

        expect(await resolveFilePreview("link.md", { rootDir: dir })).toMatchObject({ previewError: "unsafe_path" });
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it("truncates large previews", async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, "large.txt"), "abcdef");

      const preview = await resolveFilePreview("large.txt", { rootDir: dir, maxPreviewBytes: 3 });

      expect(preview).toMatchObject({
        contentKind: "text",
        contentPreview: "abc",
        contentBytes: 6,
        contentTruncated: true,
      });
    });
  });

  it("pretty prints json previews", async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, "result.json"), JSON.stringify({ ok: true }));

      const preview = await resolveFilePreview("result.json", { rootDir: dir });

      expect(preview.contentPreview).toBe("{\n  \"ok\": true\n}");
    });
  });
});

describe("hydrateFilePreviewSpec", () => {
  it("hydrates FileView props in an output spec", async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, "report.md"), "# Hydrated");

      const spec = await hydrateFilePreviewSpec({
        root: "root",
        elements: {
          root: { type: "Stack", props: { gap: "sm" }, children: ["file"] },
          file: { type: "FileView", props: { title: "Report", uri: "report.md" } },
        },
      }, { rootDir: dir });

      expect(spec.elements.file.props).toMatchObject({
        title: "Report",
        uri: "report.md",
        displayPath: "report.md",
        contentKind: "markdown",
        contentPreview: "# Hydrated",
      });
    });
  });

  it("hydrates Table props from JSON artifacts", async () => {
    await withTempDir(async (dir) => {
      await Bun.write(join(dir, "rows.json"), JSON.stringify({ rows: [{ repo: "chrona" }] }));

      const spec = await hydrateFilePreviewSpec({
        root: "root",
        elements: {
          root: { type: "Stack", props: { gap: "sm" }, children: ["table"] },
          table: { type: "Table", props: { title: "Rows", path: "rows.json" } },
        },
      }, { rootDir: dir });

      expect(spec.elements.table.props).toMatchObject({
        title: "Rows",
        path: "rows.json",
        displayPath: "rows.json",
        contentKind: "json",
        contentPreview: "{\n  \"rows\": [\n    {\n      \"repo\": \"chrona\"\n    }\n  ]\n}",
      });
    });
  });
});

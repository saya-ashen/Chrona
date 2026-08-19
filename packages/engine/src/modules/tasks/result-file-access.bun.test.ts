import { mkdtemp, rm, symlink, truncate } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it } from "bun:test";
import {
  __resetResultFileAccessGrantsForTests,
  MAX_RESULT_FILE_BYTES,
  approveResultFileAccess,
  requestResultFileAccess,
} from "./result-file-access";

async function withTempDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "chrona-result-access-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("result file access", () => {
  beforeEach(() => {
    __resetResultFileAccessGrantsForTests();
  });

  it("returns metadata before allowing one bounded local-file read", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "report.md");
      await Bun.write(path, "# Report");

      const request = await requestResultFileAccess({
        taskId: "task-1",
        requestedPath: path,
      });
      expect(request).toMatchObject({
        status: "permission_required",
        requestedPath: path,
        canonicalPath: path,
        filename: "report.md",
        extension: ".md",
        size: 8,
      });
      expect(request.requestId).toBeString();

      const approval = await approveResultFileAccess({
        taskId: "task-1",
        requestId: request.requestId!,
      });
      expect(approval).toEqual({ requestedPath: path, canonicalPath: path });

      await expect(
        approveResultFileAccess({
          taskId: "task-1",
          requestId: request.requestId!,
        }),
      ).rejects.toThrow("expired or was not found");
    });
  });

  it("binds grants to task and rejects file changes after metadata review", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "report.md");
      await Bun.write(path, "before");

      const request = await requestResultFileAccess({
        taskId: "task-1",
        requestedPath: path,
      });
      await expect(
        approveResultFileAccess({
          taskId: "task-2",
          requestId: request.requestId!,
        }),
      ).rejects.toThrow("expired or was not found");

      await Bun.write(path, "after-change");
      await expect(
        approveResultFileAccess({
          taskId: "task-1",
          requestId: request.requestId!,
        }),
      ).rejects.toThrow("File changed after access was requested");
    });
  });

  it("rejects sensitive, directory, and symlink paths before creating a grant", async () => {
    await withTempDir(async (dir) => {
      const sensitive = join(dir, "secret.md");
      const outside = await mkdtemp(join(tmpdir(), "chrona-result-outside-"));
      const link = join(dir, "link.md");
      try {
        await Bun.write(sensitive, "do not read");
        await Bun.write(join(outside, "outside.md"), "outside");
        await symlink(join(outside, "outside.md"), link);

        await expect(
          requestResultFileAccess({
            taskId: "task-1",
            requestedPath: sensitive,
          }),
        ).rejects.toThrow("sensitive path");
        await expect(
          requestResultFileAccess({ taskId: "task-1", requestedPath: dir }),
        ).rejects.toThrow("regular files");
        await expect(
          requestResultFileAccess({ taskId: "task-1", requestedPath: link }),
        ).rejects.toThrow("Symbolic links");
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it("rejects device files and sockets without reading their contents", async () => {
    await expect(
      requestResultFileAccess({ taskId: "task-1", requestedPath: "/dev/null" }),
    ).rejects.toThrow("sensitive path");

    await withTempDir(async (dir) => {
      const socketPath = join(dir, "result.sock");
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
      });
      try {
        await expect(
          requestResultFileAccess({
            taskId: "task-1",
            requestedPath: socketPath,
          }),
        ).rejects.toThrow("regular files");
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    });
  });

  it("rejects files above the result size limit without exposing content", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "oversized.txt");
      await Bun.write(path, "not read");
      await truncate(path, MAX_RESULT_FILE_BYTES + 1);

      await expect(
        requestResultFileAccess({ taskId: "task-1", requestedPath: path }),
      ).rejects.toThrow("maximum allowed result size");
    });
  });
});

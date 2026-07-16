import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it } from "bun:test";
import {
  __resetResultFileAccessGrantsForTests,
  approveResultFileAccess,
  requestResultFileAccess,
} from "./result-file-access";

describe("result file access", () => {
  beforeEach(() => {
    __resetResultFileAccessGrantsForTests();
  });

  it("issues a task-bound one-time request and consumes it on approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chrona-result-access-"));
    try {
      const path = join(dir, "report.md");
      await Bun.write(path, "# Report");

      const request = await requestResultFileAccess({
        taskId: "task-1",
        requestedPath: path,
      });
      expect(request.status).toBe("permission_required");
      if (request.status !== "permission_required")
        throw new Error("Expected permission request");
      expect(request).toMatchObject({
        requestedPath: path,
        canonicalPath: path,
        filename: "report.md",
        extension: ".md",
      });

      await expect(
        approveResultFileAccess({
          taskId: "task-2",
          requestId: request.requestId,
        }),
      ).rejects.toThrow(/expired or was not found/i);
      await expect(
        approveResultFileAccess({
          taskId: "task-1",
          requestId: request.requestId,
        }),
      ).resolves.toMatchObject({ requestedPath: path, canonicalPath: path });
      await expect(
        approveResultFileAccess({
          taskId: "task-1",
          requestId: request.requestId,
        }),
      ).rejects.toThrow(/expired or was not found/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects sensitive paths before creating an access request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chrona-result-access-"));
    try {
      const path = join(dir, ".env");
      await Bun.write(path, "SECRET=value");

      await expect(
        requestResultFileAccess({ taskId: "task-1", requestedPath: path }),
      ).rejects.toThrow(/sensitive path/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("invalidates approval when the file changes after review", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chrona-result-access-"));
    try {
      const path = join(dir, "report.md");
      await Bun.write(path, "first");
      const request = await requestResultFileAccess({
        taskId: "task-1",
        requestedPath: path,
      });
      if (request.status !== "permission_required")
        throw new Error("Expected permission request");
      await Bun.write(path, "changed content");

      await expect(
        approveResultFileAccess({
          taskId: "task-1",
          requestId: request.requestId,
        }),
      ).rejects.toThrow(/changed after access was requested/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

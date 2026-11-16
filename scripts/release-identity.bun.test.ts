import { expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RELEASE_IDENTITY_FILE, verifyReleaseIdentity, writeReleaseIdentity } from "../build/release-identity";

test("release combination rejects changed payload bytes, modes, file sets and module identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-release-identity-"));
  try {
    const payload = join(root, "release"), resources = join(payload, "resources/module-git");
    await mkdir(resources, { recursive: true });
    await writeFile(join(root, "bun.lock"), "fixture lock");
    await writeFile(join(resources, "lock.json"), JSON.stringify({ version: 1, modules: [{ name: "fixture", commit: "fixed" }] }));
    await writeFile(join(payload, "chrona"), "fixture executable", { mode: 0o755 });
    const errors = spyOn(console, "error");
    let record: Awaited<ReturnType<typeof writeReleaseIdentity>>;
    try {
      record = await writeReleaseIdentity(payload, root);
      const diagnostics = errors.mock.calls.map(([line]) => JSON.parse(String(line)));
      expect(diagnostics).toHaveLength(2);
      for (const diagnostic of diagnostics) {
        expect(diagnostic).toMatchObject({ component: "release-identity", event: "git_metadata_unavailable", exitCode: 128 });
        expect(diagnostic.error).toContain("not a git repository");
      }
    } finally { errors.mockRestore(); }
    expect(record.host).toEqual({ commit: null, workingTree: "unavailable" });
    const original = await readFile(join(payload, RELEASE_IDENTITY_FILE), "utf8");
    await verifyReleaseIdentity(payload);
    for (const mutation of ["bytes", "mode", "extra", "missing", "modules"] as const) {
      if (mutation === "bytes") await writeFile(join(payload, "chrona"), "changed");
      if (mutation === "mode") await chmod(join(payload, "chrona"), 0o644);
      if (mutation === "extra") await writeFile(join(payload, "unexpected"), "extra");
      if (mutation === "missing") await rm(join(payload, "chrona"));
      if (mutation === "modules") await writeFile(join(payload, RELEASE_IDENTITY_FILE), JSON.stringify({ ...record, modules: [] }));
      await expect(verifyReleaseIdentity(payload)).rejects.toThrow();
      await writeFile(join(payload, "chrona"), "fixture executable");
      await chmod(join(payload, "chrona"), 0o755);
      await rm(join(payload, "unexpected"), { force: true });
      await writeFile(join(payload, RELEASE_IDENTITY_FILE), original);
      await verifyReleaseIdentity(payload);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

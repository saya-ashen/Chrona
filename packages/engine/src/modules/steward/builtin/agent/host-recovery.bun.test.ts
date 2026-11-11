import { expect, spyOn, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentHostGeneration, hostStopped } from "./host-recovery";

const generation = "a".repeat(64);
const receipt = { version: 1, generation, state: "stopped", scope: "descendants", treeClean: true };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-agent-host-receipt-"));
  await mkdir(join(root, ".host-stops"), { mode: 0o700 });
  return { root, path: join(root, ".host-stops", generation + ".json") };
}

test.skipIf(process.platform !== "linux")("Agent accepts only exact descendant stop evidence for the original generation", async () => {
  const { root, path } = await fixture();
  try {
    expect(await hostStopped(root, generation)).toBe(false);
    await writeFile(path, JSON.stringify(receipt), { mode: 0o600 });
    expect(await hostStopped(root, generation)).toBe(true);
    for (const invalid of [
      { ...receipt, version: 2 }, { ...receipt, generation: "b".repeat(64) },
      { ...receipt, state: "unknown" }, { ...receipt, scope: "process-group" },
      { ...receipt, treeClean: false }, { ...receipt, treeClean: "true" },
      { version: 1, generation }, null, "malformed JSON",
    ]) {
      await writeFile(path, invalid === "malformed JSON" ? "{" : JSON.stringify(invalid));
      expect(await hostStopped(root, generation)).toBe(false);
    }
    for (const invalid of ["", "../" + generation, "A".repeat(64), "a".repeat(63)]) {
      expect(await hostStopped(root, invalid)).toBe(false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== "linux")("Agent rejects receipts with untrusted storage", async () => {
  const { root, path } = await fixture();
  try {
    await writeFile(path, JSON.stringify(receipt), { mode: 0o600 });
    await chmod(path, 0o644);
    expect(await hostStopped(root, generation)).toBe(false);
    await chmod(path, 0o600);
    const getuid = spyOn(process, "getuid").mockReturnValue(process.getuid!() + 1);
    try { expect(await hostStopped(root, generation)).toBe(false); } finally { getuid.mockRestore(); }
    await link(path, join(root, "hardlink"));
    expect(await hostStopped(root, generation)).toBe(false);
    await rm(join(root, "hardlink"));
    await writeFile(path, JSON.stringify(receipt) + " ".repeat(512));
    expect(await hostStopped(root, generation)).toBe(false);
    await rm(path);
    await writeFile(join(root, "target"), JSON.stringify(receipt), { mode: 0o600 });
    await symlink(join(root, "target"), path);
    expect(await hostStopped(root, generation)).toBe(false);
    await rm(path);
    await mkdir(path, { mode: 0o700 });
    expect(await hostStopped(root, generation)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform !== "linux")("a receipt cannot confirm termination of the current Agent host", async () => {
  const { root, path } = await fixture(), previous = process.env.CHRONA_HOST_GENERATION;
  try {
    await writeFile(path, JSON.stringify(receipt), { mode: 0o600 });
    process.env.CHRONA_HOST_GENERATION = generation;
    expect(currentHostGeneration()).toBe(generation);
    expect(await hostStopped(root, generation)).toBe(false);
    process.env.CHRONA_HOST_GENERATION = "invalid";
    expect(currentHostGeneration()).toBeUndefined();
    expect(await hostStopped(root, generation)).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.CHRONA_HOST_GENERATION;
    else process.env.CHRONA_HOST_GENERATION = previous;
    await rm(root, { recursive: true, force: true });
  }
});

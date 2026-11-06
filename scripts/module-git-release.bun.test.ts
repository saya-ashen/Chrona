import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { buildArtifacts } from "../build/manifest";
import { copyModuleGitRelease, prepareModuleGitRelease, verifyPublishedModuleGitRelease } from "./module-git-release";

const base = { hostCommit: "a".repeat(40), hostTimestamp: "1735689600" };
function git(dir: string, args: string[]) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0" } }).trim();
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-module-release-test-")), resourcesRoot = join(root, "resources"), seedDir = join(root, "seeds");
  await writeFile(join(root, "LICENSE"), "MIT License\nfixture copyright\n");
  await mkdir(join(root, buildArtifacts.moduleGit.seedDir), { recursive: true });
  await writeFile(join(root, buildArtifacts.moduleGit.seedDir, "THIRD-PARTY-NOTICES.txt"), "Fixture third-party notices\n");
  for (const module of buildArtifacts.moduleGit.modules) {
    const source = join(resourcesRoot, module.source);
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "module.json"), JSON.stringify({ name: module.name, entry: "index.ts" }));
    await writeFile(join(source, "index.ts"), `// ${module.name}\n`);
  }
  return { root, resourcesRoot, seedDir, ...base };
}

test("eleven independent unpublished seeds clone offline at their exact commits and unchanged sources reuse history", async () => {
  const f = await fixture();
  try {
    const first = await prepareModuleGitRelease(f);
    expect(first.modules).toHaveLength(11);
    const plan = JSON.parse(await readFile(join(f.seedDir, "publish-plan.json"), "utf8"));
    expect(plan.modules[0].proposedRepository).toBe("chrona-core/chrona-module-web");
    for (const entry of first.modules) {
      expect(entry.repository).toBeNull();
      expect(entry.commit).toMatch(/^[a-f0-9]{40}$/);
      const clone = join(f.root, `clone ${entry.name}`);
      git(f.root, ["clone", "--template=", "--branch", "main", join(f.seedDir, entry.bundle), clone]);
      expect(git(clone, ["rev-parse", "HEAD"])).toBe(entry.commit);
      expect(await readFile(join(clone, "index.ts"), "utf8")).toBe(`// ${entry.name}\n`);
      expect(git(clone, ["log", "-1", "--format=%s"])).toBe(`Extract initial module release from Chrona ${base.hostCommit}`);
      expect(await readFile(join(clone, "LICENSE"), "utf8")).toBe(await readFile(join(f.root, "LICENSE"), "utf8"));
      if (["web", "coding", "editor"].includes(entry.name)) expect(await readFile(join(clone, "THIRD-PARTY-NOTICES.txt"), "utf8")).toBe("Fixture third-party notices\n");
      expect(git(clone, ["rev-list", "--count", "HEAD"])).toBe("1");
    }
    const same = await prepareModuleGitRelease({ ...f, hostCommit: "b".repeat(40), hostTimestamp: "1735776000" });
    expect(same).toEqual(first);
    await rm(join(f.seedDir, "repos"), { recursive: true });
    expect(await prepareModuleGitRelease({ ...f, hostCommit: "c".repeat(40), hostTimestamp: "1735862400" })).toEqual(first);
    const copied = await copyModuleGitRelease(f.seedDir, f.resourcesRoot);
    expect(copied).toEqual(first);
    for (const file of ["LICENSE", "THIRD-PARTY-NOTICES.txt"]) expect(await readFile(join(f.resourcesRoot, "module-git", file))).toEqual(await readFile(join(f.seedDir, file)));
    expect(await copyModuleGitRelease(join(f.resourcesRoot, "module-git"), f.resourcesRoot)).toEqual(first);
    await rm(join(f.seedDir, "THIRD-PARTY-NOTICES.txt"));
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("ENOENT");
    await writeFile(join(f.resourcesRoot, "builtin/web/index.ts"), "// changed\n");
    const updated = await prepareModuleGitRelease({ ...f, hostTimestamp: "1735776000" });
    expect(updated.modules[0]!.commit).not.toBe(first.modules[0]!.commit);
    expect(git(join(f.seedDir, "repos/web.git"), ["rev-parse", `${updated.modules[0]!.commit}^`])).toBe(first.modules[0]!.commit);
    expect(updated.modules.slice(1)).toEqual(first.modules.slice(1));
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

test("clean seed generation is deterministic and rejects mismatched packaged code, incomplete bundles and checksums", async () => {
  const f = await fixture(), second = await fixture();
  try {
    const first = await prepareModuleGitRelease(f), again = await prepareModuleGitRelease(second);
    expect(first).toEqual(again);
    const source = join(f.resourcesRoot, "external/coding/contract.js");
    await writeFile(source, "// generated after seed\n");
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("differs from packaged source");
    await rm(source);
    const license = join(f.resourcesRoot, "builtin/web/LICENSE");
    await writeFile(license, "wrong license\n");
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("differs from packaged source");
    await writeFile(license, await readFile(join(f.root, "LICENSE")));
    const lockPath = join(f.seedDir, "lock.json");
    const wrong = structuredClone(first); wrong.modules[0]!.commit = "f".repeat(40);
    await writeFile(lockPath, JSON.stringify(wrong));
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("commit mismatch");
    await writeFile(lockPath, JSON.stringify({ version: 1, modules: first.modules.slice(1) }));
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("incomplete");
    await writeFile(lockPath, JSON.stringify(first));
    await writeFile(join(f.seedDir, first.modules[0]!.bundle), "corrupt bundle");
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("checksum mismatch");
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(second.root, { recursive: true, force: true }); }
}, 30_000);


test.skipIf(process.platform === "win32")("public upstream verification never marks a private repository ready or partially writes the lock", async () => {
  const f = await fixture(), path = process.env.PATH;
  try {
    const lock = await prepareModuleGitRelease(f), before = await readFile(join(f.seedDir, "lock.json"), "utf8");
    const bin = join(f.root, "bin"); await mkdir(bin);
    await writeFile(join(bin, "gh"), `#!/bin/sh\nprintf '{"visibility":"PRIVATE","url":"https://github.com/%s","nameWithOwner":"%s","owner":{"login":"chrona-core"}}\\n' "$3" "$3"\n`);
    await chmod(join(bin, "gh"), 0o755);
    process.env.PATH = bin;
    await expect(verifyPublishedModuleGitRelease(f.seedDir)).rejects.toThrow("Public module upstream is not at the packaged commit");
    expect(await readFile(join(f.seedDir, "lock.json"), "utf8")).toBe(before);
    await writeFile(join(bin, "gh"), `#!/bin/sh\nprintf '{"visibility":"PUBLIC","url":"https://github.com/%s","nameWithOwner":"%s","owner":{"login":"chrona-core"}}\\n' "$3" "$3"\n`);
    const publicGh = await readFile(join(bin, "gh"), "utf8");
    await writeFile(join(bin, "gh"), publicGh.replace('"login":"chrona-core"', '"login":"saya-ashen"'));
    await expect(verifyPublishedModuleGitRelease(f.seedDir)).rejects.toThrow("Public module upstream is not at the packaged commit");
    expect(await readFile(join(f.seedDir, "lock.json"), "utf8")).toBe(before);
    await writeFile(join(bin, "gh"), publicGh);
    const cases = lock.modules.map(entry => `*chrona-module-${entry.name}*) printf '${entry.commit}\\trefs/heads/main\\n';;`).join("\n");
    await writeFile(join(bin, "git"), `#!/bin/sh\ncase "$*" in\n${cases}\n*) exit 1;;\nesac\n`);
    await chmod(join(bin, "git"), 0o755);
    const verified = await verifyPublishedModuleGitRelease(f.seedDir);
    expect(verified.modules.every(entry => entry.repository === `https://github.com/chrona-core/chrona-module-${entry.name}`)).toBe(true);
  } finally {
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path;
    await rm(f.root, { recursive: true, force: true });
  }
}, 30_000);

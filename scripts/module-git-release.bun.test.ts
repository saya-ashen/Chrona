import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "bun:test";
import { buildArtifacts } from "../build/manifest";
import { MODULE_MATERIAL_FILE, MODULE_SOURCE_MAX_BYTES, parseModuleMaterial, type ModuleMaterial } from "../packages/contracts/src/steward/module-material";
import { copyModuleGitRelease, moduleGitReleaseSource, prepareModuleGitRelease, stageModuleGitLicense, verifyPublishedModuleGitRelease } from "./module-git-release";

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

test("independent unpublished seeds clone offline at their exact commits and unchanged sources reuse history", async () => {
  const f = await fixture();
  try {
    const first = await prepareModuleGitRelease(f);
    expect(first.modules.map(module => module.name).sort()).toEqual(["author", "chat", "mind", "notify", "pi", "qq", "web"]);
    expect(first.modules.map(module => module.name)).toEqual(buildArtifacts.moduleGit.modules.map(module => module.name));
    expect(first.modules.some(module => module.name === "editor")).toBe(false);
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
      if (entry.name === "web") expect(await readFile(join(clone, "THIRD-PARTY-NOTICES.txt"), "utf8")).toBe("Fixture third-party notices\n");
      else expect(await Bun.file(join(clone, "THIRD-PARTY-NOTICES.txt")).exists()).toBe(false);
      expect(git(clone, ["rev-list", "--count", "HEAD"])).toBe("1");
    }
    const same = await prepareModuleGitRelease({ ...f, hostCommit: "b".repeat(40), hostTimestamp: "1735776000" });
    expect(same).toEqual(first);
    await rm(join(f.seedDir, "repos"), { recursive: true });
    expect(await prepareModuleGitRelease({ ...f, hostCommit: "c".repeat(40), hostTimestamp: "1735862400" })).toEqual(first);
    const copied = await copyModuleGitRelease(f.seedDir, f.resourcesRoot);
    expect(copied).toEqual(first);
    for (const file of ["LICENSE", "THIRD-PARTY-NOTICES.txt"]) expect(await readFile(join(f.resourcesRoot, "module-git", file))).toEqual(await readFile(join(f.seedDir, file)));
    const inPlace = join(f.resourcesRoot, "module-git");
    await mkdir(join(inPlace, "repos"));
    await writeFile(join(inPlace, "repos", "old-process.txt"), "development history");
    await writeFile(join(inPlace, "publish-plan.json"), "local paths");
    await writeFile(join(inPlace, "obsolete.bundle"), "old commits");
    expect(await copyModuleGitRelease(inPlace, f.resourcesRoot)).toEqual(first);
    expect((await readdir(inPlace)).sort()).toEqual(["LICENSE", "THIRD-PARTY-NOTICES.txt", "lock.json", ...first.modules.map(entry => entry.bundle)].sort());
    await rm(join(f.seedDir, "THIRD-PARTY-NOTICES.txt"));
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("ENOENT");
    await writeFile(join(f.resourcesRoot, "external/web/index.ts"), "// changed\n");
    const updated = await prepareModuleGitRelease({ ...f, hostTimestamp: "1735776000" });
    expect(updated.modules[0]!.commit).not.toBe(first.modules[0]!.commit);
    expect(git(join(f.seedDir, "repos/web.git"), ["rev-parse", `${updated.modules[0]!.commit}^`])).toBe(first.modules[0]!.commit);
    expect(updated.modules.slice(1)).toEqual(first.modules.slice(1));
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

test("Pi seed migration retains retired Agent metadata and history while packaging only active modules", async () => {
  const f = await fixture();
  try {
    const initial = await prepareModuleGitRelease(f), pi = initial.modules.find(entry => entry.name === "pi")!;
    // Model an earlier lock with Agent instead of Pi, retaining a real bundle and exact history.
    const historical = { ...pi, name: "agent", repository: "https://github.com/chrona-core/chrona-module-agent", bundle: "agent.bundle" };
    await cp(join(f.seedDir, pi.bundle), join(f.seedDir, historical.bundle));
    const historicalBytes = await readFile(join(f.seedDir, historical.bundle));
    const old = { version: 1, modules: initial.modules.map(entry => entry.name === "pi" ? historical : entry) };
    await writeFile(join(f.seedDir, "lock.json"), JSON.stringify(old));
    await rm(join(f.seedDir, "pi.bundle"));
    await rm(join(f.seedDir, "repos/pi.git"), { recursive: true });
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("incomplete: pi");
    const migrated = await prepareModuleGitRelease(f);
    expect(migrated.modules.find(entry => entry.name === "agent")).toEqual(historical);
    expect(await readFile(join(f.seedDir, historical.bundle))).toEqual(historicalBytes);
    expect(migrated.modules.filter(entry => entry.name !== "agent")).toEqual(initial.modules);
    const plan = JSON.parse(await readFile(join(f.seedDir, "publish-plan.json"), "utf8"));
    expect(plan.modules.some((entry: { name: string }) => entry.name === "agent")).toBe(false);
    expect(plan.modules.some((entry: { name: string }) => entry.name === "pi")).toBe(true);
    expect(await copyModuleGitRelease(f.seedDir, f.resourcesRoot)).toEqual(initial);
    expect(await Bun.file(join(f.resourcesRoot, "module-git/agent.bundle")).exists()).toBe(false);
    expect(JSON.parse(await readFile(join(f.seedDir, "lock.json"), "utf8"))).toEqual(migrated);
    await rm(join(f.seedDir, "repos"), { recursive: true });
    expect(await prepareModuleGitRelease({ ...f, hostCommit: "b".repeat(40), hostTimestamp: "1735776000" })).toEqual(migrated);
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

test("clean seed generation is deterministic and rejects mismatched packaged code, incomplete bundles and checksums", async () => {
  const f = await fixture(), second = await fixture();
  try {
    const first = await prepareModuleGitRelease(f), again = await prepareModuleGitRelease(second);
    expect(first).toEqual(again);
    for (const name of ["chat", "mind"]) {
      const source = join(f.resourcesRoot, `external/${name}/contract.js`);
      await writeFile(source, "// generated after seed\n");
      await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow(`Module seed differs from packaged source: ${name}`);
      await rm(source);
    }
    const license = join(f.resourcesRoot, "external/web/LICENSE");
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
    const cases = lock.modules.map(entry => `*"https://github.com/chrona-core/chrona-module-${entry.name} refs/heads/main") printf '${entry.commit}\\trefs/heads/main\\n';;`).join("\n");
    await writeFile(join(bin, "git"), `#!/bin/sh\ncase "$*" in\n${cases}\n*) exit 1;;\nesac\n`);
    await chmod(join(bin, "git"), 0o755);
    const verified = await verifyPublishedModuleGitRelease(f.seedDir);
    expect(verified.modules.every(entry => entry.repository === `https://github.com/chrona-core/chrona-module-${entry.name}`)).toBe(true);
  } finally {
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path;
    await rm(f.root, { recursive: true, force: true });
  }
}, 30_000);

const webRoot = resolve(import.meta.dirname, "../.generated/applications/web");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("actual Web release preserves all source and verifies artifacts while Git contains source and record only", async () => {
  const f = await fixture(), web = join(f.resourcesRoot, "external/web");
  try {
    await cp(webRoot, web, { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ["node_modules", ".git", ".venv", ".chrona"].includes(part)) });
    // A local checkout and installed dependencies are never part of release material.
    for (const dir of [".git", "node_modules", ".venv", ".chrona"]) {
      await mkdir(join(web, dir));
      await writeFile(join(web, dir, "ignored"), "local state");
    }
    const record = parseModuleMaterial(JSON.parse(await readFile(join(web, MODULE_MATERIAL_FILE), "utf8")));
    expect(record.artifacts.map(artifact => artifact.path)).toEqual(["pages.js", "style.css"]);
    expect(record.source).toEqual(expect.arrayContaining(["build.ts", "bun.lock", "package.json", "src/pages.tsx", "src/pages.css", "src/base.css", "shell.css", "module.json"]));
    expect(record.source.some(path => path.endsWith(".bun.test.ts"))).toBe(true);
    expect(record.build.commands).toEqual(["bun run build.ts"]);
    expect(record.build.toolchain).toMatch(/^Bun /);
    expect(record.build.target).toBe("browser");
    const selected = await moduleGitReleaseSource(web);
    expect(selected.map(file => file.path)).toEqual([MODULE_MATERIAL_FILE, ...record.source].sort((a, b) => a.localeCompare(b)));
    expect(selected.reduce((total, file) => total + file.bytes.byteLength, 0)).toBeLessThanOrEqual(MODULE_SOURCE_MAX_BYTES);
    const lock = await prepareModuleGitRelease(f), entry = lock.modules.find(entry => entry.name === "web")!;
    const clone = join(f.root, "web-clone");
    git(f.root, ["clone", "--template=", "--branch", "main", join(f.seedDir, entry.bundle), clone]);
    expect(git(clone, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n").sort()).toEqual(selected.map(file => file.path).sort());
    for (const file of await moduleGitReleaseSource(web)) expect((await readFile(join(clone, file.path))).equals(file.bytes)).toBe(true);
    for (const artifact of record.artifacts) {
      expect(sha256(await readFile(join(web, artifact.path)))).toBe(artifact.sha256);
      await expect(readFile(join(clone, artifact.path))).rejects.toThrow("ENOENT");
    }
    expect(await copyModuleGitRelease(f.seedDir, f.resourcesRoot)).toEqual(lock);
    // Rebuild exported source with offline dependencies and no Chrona repository files.
    execFileSync(process.execPath, ["install", "--offline", "--frozen-lockfile", "--ignore-scripts", "--no-progress"], { cwd: clone, stdio: "pipe", timeout: 20_000 });
    execFileSync(process.execPath, ["run", "build.ts"], { cwd: clone, stdio: "pipe", timeout: 20_000 });
    const rebuilt = parseModuleMaterial(JSON.parse(await readFile(join(clone, MODULE_MATERIAL_FILE), "utf8")));
    expect(rebuilt).toEqual(record);
    for (const artifact of record.artifacts) expect(sha256(await readFile(join(clone, artifact.path)))).toBe(artifact.sha256);
    const output = join(web, "pages.js"), original = await readFile(output);
    const corrupt = Buffer.from(original); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    await writeFile(output, corrupt);
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("artifact digest or executable mode mismatch");
    await expect(prepareModuleGitRelease(f)).rejects.toThrow("artifact digest or executable mode mismatch");
    await writeFile(output, original);
    await writeFile(join(web, "src/unlisted.ts"), "// preserved input must be declared\n");
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("undeclared material");
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

async function explicitFixture() {
  const f = await fixture(), web = join(f.resourcesRoot, "external/web");
  await stageModuleGitLicense(f.resourcesRoot, join(f.root, "LICENSE"), join(f.root, buildArtifacts.moduleGit.seedDir, "THIRD-PARTY-NOTICES.txt"));
  const artifact = Buffer.alloc(MODULE_SOURCE_MAX_BYTES + 1, 0xab);
  await writeFile(join(web, "runtime.bin"), artifact);
  const record: ModuleMaterial = {
    schema: 1, source: ["module.json", "index.ts", "LICENSE", "THIRD-PARTY-NOTICES.txt"],
    artifacts: [{ path: "runtime.bin", sha256: sha256(artifact), executable: false }],
    build: { commands: ["build-runtime"], toolchain: "fixture", target: "portable" },
  };
  await writeFile(join(web, MODULE_MATERIAL_FILE), JSON.stringify(record));
  return { ...f, web, record };
}

test("explicit material verifies artifacts independently, limits source, and uses strict shared contracts", async () => {
  const f = await explicitFixture(), recordPath = join(f.web, MODULE_MATERIAL_FILE);
  try {
    expect((await moduleGitReleaseSource(f.web)).map(file => file.path)).not.toContain("runtime.bin");
    const invalidRecords = [
      { ...f.record, extra: true },
      { ...f.record, source: [...f.record.source, "index.ts"] },
      { ...f.record, source: [...f.record.source, MODULE_MATERIAL_FILE] },
      { ...f.record, source: [...f.record.source, "../outside"] },
      { ...f.record, source: f.record.source.filter(path => path !== "module.json") },
      { ...f.record, source: [...f.record.source, "runtime.bin"] },
      { ...f.record, source: [...f.record.source, "index.ts/child"] },
      { ...f.record, build: { ...f.record.build, extra: true } },
      { ...f.record, artifacts: [{ ...f.record.artifacts[0], extra: true }] },
    ];
    for (const record of invalidRecords) {
      await writeFile(recordPath, JSON.stringify(record));
      await expect(moduleGitReleaseSource(f.web)).rejects.toThrow();
    }
    await writeFile(recordPath, JSON.stringify(f.record));
    const initial = await moduleGitReleaseSource(f.web);
    const otherBytes = initial.filter(file => file.path !== "index.ts").reduce((total, file) => total + file.bytes.byteLength, 0);
    const source = Buffer.alloc(MODULE_SOURCE_MAX_BYTES - otherBytes, 0x61);
    expect(source.byteLength).toBeGreaterThan(1024 * 1024);
    await writeFile(join(f.web, "index.ts"), source);
    const selected = await moduleGitReleaseSource(f.web);
    expect(selected.reduce((total, file) => total + file.bytes.byteLength, 0)).toBe(2 * 1024 * 1024);
    expect(selected.find(file => file.path === "index.ts")!.bytes).toEqual(source);
    await writeFile(join(f.web, "index.ts"), Buffer.concat([source, Buffer.from("x")]));
    await expect(moduleGitReleaseSource(f.web)).rejects.toThrow("source file limits");
    await writeFile(join(f.web, "index.ts"), "// restored\n");
    await rm(join(f.web, "runtime.bin"));
    await expect(moduleGitReleaseSource(f.web)).rejects.toThrow();
    await writeFile(join(f.web, "runtime.bin"), Buffer.alloc(MODULE_SOURCE_MAX_BYTES + 1, 0xab));
    await rm(join(f.web, "index.ts"));
    await expect(moduleGitReleaseSource(f.web)).rejects.toThrow("Declared module source is missing");
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

test.skipIf(process.platform === "win32")("explicit source modes enter Git and artifact modes are checked; legacy Git remains unchanged", async () => {
  const f = await explicitFixture();
  try {
    await chmod(join(f.web, "index.ts"), 0o755);
    await chmod(join(f.web, "runtime.bin"), 0o755);
    await expect(prepareModuleGitRelease(f)).rejects.toThrow("artifact digest or executable mode mismatch");
    f.record.artifacts[0]!.executable = true;
    await writeFile(join(f.web, MODULE_MATERIAL_FILE), JSON.stringify(f.record));
    const lock = await prepareModuleGitRelease(f), repo = join(f.seedDir, "repos/web.git");
    expect(git(repo, ["ls-tree", "HEAD", "index.ts"])).toMatch(/^100755 blob /);
    expect(await copyModuleGitRelease(f.seedDir, f.resourcesRoot)).toEqual(lock);
    await chmod(join(f.web, "index.ts"), 0o644);
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("differs from packaged source");
    await chmod(join(f.web, "index.ts"), 0o755);
    await chmod(join(f.web, "runtime.bin"), 0o644);
    await expect(copyModuleGitRelease(f.seedDir, f.resourcesRoot)).rejects.toThrow("artifact digest or executable mode mismatch");
    await rm(join(f.web, MODULE_MATERIAL_FILE));
    const legacy = await prepareModuleGitRelease(f);
    expect(git(repo, ["ls-tree", "HEAD", "index.ts"])).toMatch(/^100644 blob /);
    expect(git(repo, ["ls-tree", "HEAD", "runtime.bin"])).toMatch(/^100644 blob /);
    // Legacy releases still include every file even when their total payload exceeds 1 MiB.
    expect(await copyModuleGitRelease(f.seedDir, f.resourcesRoot)).toEqual(legacy);
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

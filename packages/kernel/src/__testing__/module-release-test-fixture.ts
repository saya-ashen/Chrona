import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { commitModuleSource, moduleGitPath } from "../modules/module-git";
import { snapshotModuleMaterial } from "../modules/module-artifacts";
import { existsSync } from "node:fs";
import type { StewardPorts } from "../ports";
import runtimeDeclarations from "../../../host/src/runtimes.json";

/** Use the shipped SDK and runtime checks; installation fixtures must not silently skip typechecking. */
export function testReleaseRuntimeChecks(): Pick<StewardPorts, "moduleSdk" | "moduleTypecheck" | "moduleRuntimes"> {
  const sdk = resolve(import.meta.dirname, "../../../app-sdk");
  return { moduleSdk: sdk, moduleTypecheck: join(sdk, "typecheck"), moduleRuntimes: runtimeDeclarations };
}

/** Synthetic fixtures retain ancestry across release edits, without any network or user database. */
export async function seedTestModuleRelease(resourcesRoot: string, name: string, repository: string | null = null) {
  const platform = join(resourcesRoot, ".test-release-git"), moduleId = name;
  // Validate complete material first. commitModuleSource stores its verified
  // artifact bytes separately and selects only source + record for Git.
  const files = await snapshotModuleMaterial(resourcesRoot, name, { verifyTree: true });
  const revision = await commitModuleSource({ platform, moduleId, versionId: randomUUID(), files, message: "Synthetic module release" });
  const seedDir = join(dirname(resourcesRoot), "module-git"); await mkdir(seedDir, { recursive: true });
  const bundlePath = join(seedDir, `${name}.bundle`), repo = moduleGitPath(platform, moduleId);
  execFileSync("git", ["--git-dir", repo, "update-ref", "refs/heads/main", revision.commit]);
  await rm(bundlePath, { force: true });
  execFileSync("git", ["--git-dir", repo, "bundle", "create", bundlePath, "refs/heads/main"]);
  const entry = { name, repository, branch: "main", commit: revision.commit, bundle: `${name}.bundle`, bundleSha256: createHash("sha256").update(await readFile(bundlePath)).digest("hex") };
  let modules: typeof entry[] = [];
  try { modules = (JSON.parse(await readFile(join(seedDir, "lock.json"), "utf8")) as { modules: typeof entry[] }).modules; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await writeFile(join(seedDir, "lock.json"), JSON.stringify({ version: 1, modules: [...modules.filter(item => item.name !== name), entry] }));
  return { ...revision, bundlePath, repository, branch: "main" };
}


/** Reuse fixture resources' installed dependencies without package installation or network access. */
export function testReleasePackages(resourcesRoot: string): NonNullable<StewardPorts["packages"]> {
  return { async install({ dir, packages }) {
    if (packages.length || existsSync(join(dir, "pyproject.toml"))) throw new Error("Release fixture adapter only reuses bundled npm dependencies");
    const npm = existsSync(join(dir, "package.json"));
    if (npm) {
      const manifest = JSON.parse(await readFile(join(dir, "module.json"), "utf8")) as { name: string };
      const modules = resolve(resourcesRoot, manifest.name, "node_modules");
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      await mkdir(join(dir, "node_modules"), { recursive: true });
      for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (!(await stat(join(modules, name))).isDirectory()) throw new Error(`Release fixture dependency missing: ${name}`);
        const target = join(dir, "node_modules", name);
        await mkdir(dirname(target), { recursive: true });
        await symlink(join(modules, name), target, "dir");
      }
    }
    return { errors: [], installed: { npm, python: false, packages: {} } };
  } };
}

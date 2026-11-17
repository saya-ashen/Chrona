import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { snapshotModule } from "../modules/module-files";
import { moduleMaterialDigest, snapshotModuleMaterial, storeVersionMaterial } from "../modules/module-artifacts";
import { existsSync } from "node:fs";
import type { StewardPorts } from "../ports";

/** Use the shipped SDK for installation and startup checks. */
export function testReleaseRuntimeChecks(): Pick<StewardPorts, "moduleSdk"> {
  const sdk = resolve(import.meta.dirname, "../../../app-sdk");
  return { moduleSdk: sdk };
}

export async function seedTestModuleRelease(resourcesRoot: string, name: string) {
  const record = join(resourcesRoot, name, "chrona-material.json");
  if (!existsSync(record)) {
    const files = await snapshotModule(resourcesRoot, name);
    await writeFile(record, JSON.stringify({ schema: 1, source: files.map(file => file.path), artifacts: [], build: { commands: [], toolchain: "interpreted fixture", target: "host" } }));
  }
  const files = await snapshotModuleMaterial(resourcesRoot, name, { verifyTree: true });
  return { hash: moduleMaterialDigest(files) };
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

export async function storeTestModuleMaterial(platform: string, manifest: Record<string, unknown>, label = "fixture") {
  const paths = new Set(["index.ts", ...((manifest.tests ?? []) as string[]), ...((manifest.data as { migrate?: string } | undefined)?.migrate ? [(manifest.data as { migrate: string }).migrate] : [])]);
  const files = [{ path: "module.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    ...[...paths].map(path => ({ path, bytes: Buffer.from(`export const fixtureVersion = ${JSON.stringify(label)};\n`) }))];
  files.push({ path: "chrona-material.json", bytes: Buffer.from(JSON.stringify({ schema: 1, source: files.map(file => file.path), artifacts: [], build: { commands: [], toolchain: "interpreted fixture", target: "host" } })) });
  return storeVersionMaterial(platform, files);
}

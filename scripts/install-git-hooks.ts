#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function shouldInstallGitHooks(
  root: string,
  env: { CI?: string } = process.env as { CI?: string },
) {
  return !env.CI && existsSync(resolve(root, ".git"));
}

export async function installGitHooks(root = resolve(import.meta.dirname, "..")) {
  if (!shouldInstallGitHooks(root)) {
    console.log("Skipping Git hook installation outside a local Git checkout.");
    return false;
  }

  await $`bunx --bun lefthook install`.cwd(root);
  return true;
}

if (import.meta.main) {
  await installGitHooks();
}

#!/usr/bin/env bun

import { ESLint } from "eslint";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const textDecoder = new TextDecoder();
const lintableExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

type ProcessResult = {
  exitCode: number;
  stdout: string;
};

type Debt = {
  errors: number;
  warnings: number;
};

function run(command: string[]): ProcessResult {
  const result = Bun.spawnSync(command, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode, stdout: textDecoder.decode(result.stdout) };
}

function git(args: string[]): string | null {
  const result = run(["git", ...args]);
  return result.exitCode === 0 ? result.stdout : null;
}

function refExists(ref: string): boolean {
  return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;
}

function resolveBaseRef(): string {
  const requestedBase = process.env.LINT_RATCHET_BASE;
  if (requestedBase && refExists(requestedBase)) return requestedBase;

  const githubBase = process.env.GITHUB_BASE_REF;
  if (githubBase && refExists(`origin/${githubBase}`)) return `origin/${githubBase}`;
  if (refExists("origin/main")) return "origin/main";
  return refExists("HEAD^") ? "HEAD^" : "HEAD";
}

function pathsFromGit(args: string[]): string[] {
  return git(args)?.split("\0").filter(Boolean) ?? [];
}

function isLintablePath(path: string): boolean {
  return lintableExtensions.has(path.slice(path.lastIndexOf("."))) && existsSync(resolve(ROOT, path));
}

function changedLintableFiles(baseRef: string): string[] {
  const files = new Set<string>();
  for (const args of [
    ["diff", "--name-only", "-z", "--diff-filter=ACMR", `${baseRef}...HEAD`],
    ["diff", "--name-only", "-z", "--diff-filter=ACMR"],
    ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
  ]) {
    for (const path of pathsFromGit(args)) if (isLintablePath(path)) files.add(path);
  }
  return [...files].sort();
}

function debt(result: { errorCount: number; warningCount: number }): Debt {
  return { errors: result.errorCount, warnings: result.warningCount };
}

function formatDebt(path: string, baseline: Debt, current: Debt): string {
  return `${path}: warnings ${baseline.warnings} → ${current.warnings}, errors ${baseline.errors} → ${current.errors}`;
}

const baseRef = resolveBaseRef();
const files = changedLintableFiles(baseRef);
if (files.length === 0) {
  console.log(`Lint ratchet: no changed lintable files relative to ${baseRef}.`);
  process.exit(0);
}

const eslint = new ESLint({ cwd: ROOT });
const currentResults = await eslint.lintFiles(files);
const currentByPath = new Map(currentResults.map((result) => [resolve(ROOT, result.filePath), debt(result)]));
const regressions: string[] = [];

for (const path of files) {
  const source = git(["show", `${baseRef}:${path}`]);
  const current = currentByPath.get(resolve(ROOT, path)) ?? { errors: 0, warnings: 0 };
  if (source === null) {
    if (current.errors > 0 || current.warnings > 0) regressions.push(formatDebt(path, { errors: 0, warnings: 0 }, current));
    continue;
  }

  const [baselineResult] = await eslint.lintText(source, { filePath: resolve(ROOT, path) });
  const baseline = debt(baselineResult);
  if (current.errors > baseline.errors || current.warnings > baseline.warnings) {
    regressions.push(formatDebt(path, baseline, current));
  }
}

const formatter = await eslint.loadFormatter();
const rendered = await formatter.format(currentResults);
if (rendered) process.stdout.write(rendered);

if (regressions.length > 0) {
  console.error(`Lint ratchet rejected new per-file debt relative to ${baseRef}:\n${regressions.join("\n")}`);
  process.exit(1);
}

if (currentResults.some((result) => result.errorCount > 0)) process.exit(1);
console.log(`Lint ratchet passed: ${files.length} changed file(s) did not increase lint debt relative to ${baseRef}.`);

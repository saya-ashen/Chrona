#!/usr/bin/env bun

import { applicationBaselineSources, checkStagedApplicationInputs } from "./application-git-inputs";
import { restoredApplicationSources, restoreApplications } from "./restore-applications";

import { ESLint } from "eslint";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

await restoreApplications();
const ROOT = resolve(import.meta.dirname, "..");
const textDecoder = new TextDecoder();
const lintableExtensions = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
]);

type ProcessResult = {
	exitCode: number;
	stdout: string;
};

type Debt = {
	errors: number;
	warnings: number;
};

function run(command: string[]): ProcessResult {
	const result = Bun.spawnSync(command, {
		cwd: ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: result.exitCode,
		stdout: textDecoder.decode(result.stdout),
	};
}

function git(args: string[]): string | null {
	const result = run(["git", ...args]);
	return result.exitCode === 0 ? result.stdout : null;
}

function refExists(ref: string): boolean {
	return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;
}

function candidateBaseRefs(stagedOnly: boolean): string[] {
	const upstream = git([
		"rev-parse",
		"--abbrev-ref",
		"--symbolic-full-name",
		"@{u}",
	])?.trim();
	const githubBase = process.env.GITHUB_BASE_REF;
	return [
		process.env.LINT_RATCHET_BASE ?? "",
		stagedOnly ? "HEAD" : "",
		githubBase ? `origin/${githubBase}` : "",
		upstream ?? "",
		"origin/platform-v2",
		"origin/main",
		"HEAD^",
	].filter(Boolean);
}

function resolveBaseRef(stagedOnly: boolean): string {
	return candidateBaseRefs(stagedOnly).find(refExists) ?? "HEAD";
}

function pathsFromGit(args: string[]): string[] {
	return git(args)?.split("\0").filter(Boolean) ?? [];
}

function isLintablePath(path: string): boolean {
	return (
		lintableExtensions.has(path.slice(path.lastIndexOf("."))) &&
		existsSync(resolve(ROOT, path))
	);
}

function changedLintableFiles(baseRef: string, stagedOnly: boolean): string[] {
	if (stagedOnly) {
		return pathsFromGit(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"])
			.filter(isLintablePath)
			.sort((left, right) => left.localeCompare(right));
	}
	const files = new Set<string>();
	for (const args of [
		["diff", "--name-only", "-z", "--diff-filter=ACMR", `${baseRef}...HEAD`],
		["diff", "--name-only", "-z", "--diff-filter=ACMR"],
		["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
		["ls-files", "--others", "--exclude-standard", "-z"],
	]) {
		for (const path of pathsFromGit(args))
			if (isLintablePath(path)) files.add(path);
	}
	return [...files].sort((left, right) => left.localeCompare(right));
}

function debt(result: { errorCount: number; warningCount: number }): Debt {
	return { errors: result.errorCount, warnings: result.warningCount };
}

function formatDebt(path: string, baseline: Debt, current: Debt): string {
	return `${path}: warnings ${baseline.warnings} → ${current.warnings}, errors ${baseline.errors} → ${current.errors}`;
}

const args = process.argv.slice(2);
const stagedOnly = args.includes("--staged");
const explicitFiles = args.filter((arg) => !arg.startsWith("-"));
const baseRef = resolveBaseRef(stagedOnly);
if (stagedOnly) checkStagedApplicationInputs(ROOT);
const applicationBaseline = applicationBaselineSources(ROOT, baseRef);
const eslint = new ESLint({ cwd: ROOT });
const applicationPrefix = "packages/engine/src/modules/steward/applications/";
const applicationFiles = (await restoredApplicationSources()).filter(isLintablePath);
const candidates =
	explicitFiles.length > 0
		? explicitFiles.filter(isLintablePath)
		: [...new Set([...changedLintableFiles(baseRef, stagedOnly), ...applicationFiles])];
const files: string[] = [];
for (const path of candidates) {
	if (!await eslint.isPathIgnored(resolve(ROOT, path))) files.push(path);
}
if (files.length === 0) {
	console.log(
		`Lint ratchet: no changed lintable files relative to ${baseRef}.`,
	);
	process.exit(0);
}

async function collectCurrentResults(eslintInstance: ESLint, targetPaths: string[], useStagedIndex: boolean) {
	if (!useStagedIndex) return eslintInstance.lintFiles(targetPaths);
	const results = [];
	for (const path of targetPaths) {
		if (path.startsWith(applicationPrefix)) {
			results.push(...await eslintInstance.lintFiles([path]));
			continue;
		}
		const stagedText = git(["show", `:${path}`]);
		if (stagedText === null) continue;
		results.push(...await eslintInstance.lintText(stagedText, { filePath: resolve(ROOT, path) }));
	}
	return results;
}

const currentResults = await collectCurrentResults(eslint, files, stagedOnly && explicitFiles.length === 0);
const currentByPath = new Map(
	currentResults.map((result) => [
		resolve(ROOT, result.filePath),
		debt(result),
	]),
);
const regressions: string[] = [];
const inheritedApplicationDebt = new Set<string>();

for (const path of files) {
	const baselinePath = path.replace(applicationPrefix, "packages/engine/src/modules/steward/external/");
	const source = path.startsWith(applicationPrefix) && applicationBaseline
		? applicationBaseline.get(path) ?? null
		: git(["show", `${baseRef}:${baselinePath}`]);
	const current = currentByPath.get(resolve(ROOT, path)) ?? {
		errors: 0,
		warnings: 0,
	};
	if (source === null) {
		if (current.errors > 0 || current.warnings > 0)
			regressions.push(formatDebt(path, { errors: 0, warnings: 0 }, current));
		continue;
	}

	const [baselineResult] = await eslint.lintText(source, {
		filePath: resolve(ROOT, path),
	});
	const baseline = debt(baselineResult);
	if (path.startsWith(applicationPrefix) && current.errors <= baseline.errors && current.warnings <= baseline.warnings) {
		inheritedApplicationDebt.add(resolve(ROOT, path));
	}
	if (
		current.errors > baseline.errors ||
		current.warnings > baseline.warnings
	) {
		regressions.push(formatDebt(path, baseline, current));
	}
}

const formatter = await eslint.loadFormatter();
const rendered = await formatter.format(currentResults);
if (rendered) process.stdout.write(rendered);

if (regressions.length > 0) {
	console.error(
		`Lint ratchet rejected new per-file debt relative to ${baseRef}:\n${regressions.join("\n")}`,
	);
	process.exit(1);
}

if (currentResults.some((result) => result.fatalErrorCount > 0 ||
	result.errorCount > 0 && !inheritedApplicationDebt.has(resolve(ROOT, result.filePath)))) process.exit(1);
console.log(
	`Lint ratchet passed: ${files.length} changed file(s) did not increase lint debt relative to ${baseRef}.`,
);

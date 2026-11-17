#!/usr/bin/env bun


import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, basename, relative, resolve } from "node:path";
import { type GuardrailCheckName, runGuardrails, selectGuardrailChecksForPaths } from "./check-guardrails";

const ROOT = resolve(import.meta.dirname, "..");
const decoder = new TextDecoder();
const CODE_EXT_RE = /\.(?:[cm]?[jt]sx?)$/u;
const BUN_TEST_RE = /\.bun\.test\.[jt]sx?$/u;

interface StepResult {
	name: string;
	ok: boolean;
	durationMs: number;
	summary: string;
	details?: string;
}

function gitLines(args: string[]): string[] {
	const proc = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0) return [];
	return decoder.decode(proc.stdout).split("\0").filter(Boolean);
}

function expandInputPaths(inputs: string[]): string[] {
	const out = new Set<string>();
	const visit = (relOrAbs: string) => {
		const abs = resolve(ROOT, relOrAbs);
		if (!existsSync(abs)) return;
		const rel = relative(ROOT, abs).replace(/\\/gu, "/");
		if (rel.startsWith("plans/") || rel.includes("/node_modules/") || rel.startsWith(".git/")) return;
		const st = statSync(abs);
		if (st.isFile()) {
			out.add(rel);
			return;
		}
		if (!st.isDirectory()) return;
		for (const entry of readdirSync(abs)) {
			if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
			visit(resolve(abs, entry));
		}
	};
	for (const item of inputs) visit(item);
	return [...out].sort();
}

async function discoverWorkspaceChangedFiles(): Promise<string[]> {
	const tracked = gitLines(["diff", "--name-only", "-z", "--diff-filter=ACMR", "HEAD"]);
	const untracked = gitLines(["ls-files", "--others", "--exclude-standard", "-z"]);
	return [...new Set([...tracked, ...untracked])]
		.filter((p) => !p.startsWith("plans/") && !p.startsWith(".serena/") && existsSync(resolve(ROOT, p)))
		.sort();
}

function discoverRelatedTests(targetFiles: string[]): { bunTests: string[]; apiTests: string[] } {
	const bunSet = new Set<string>();
	const apiSet = new Set<string>();
	const registerTest = (relPath: string) => {
		if (!BUN_TEST_RE.test(relPath) || !existsSync(resolve(ROOT, relPath))) return;
		if (relPath.startsWith("apps/server/")) apiSet.add(relPath);
		else bunSet.add(relPath);
	};

	for (const file of targetFiles) {
		if (BUN_TEST_RE.test(file)) {
			registerTest(file);
			continue;
		}
		if (!CODE_EXT_RE.test(file)) continue;
		const ext = extname(file);
		const stem = basename(file, ext);
		const dir = dirname(file);
		for (const candidate of [`${dir}/${stem}.bun.test.ts`, `${dir}/${stem}.bun.test.tsx`]) {
			registerTest(candidate);
		}
	}
	return { bunTests: [...bunSet].sort(), apiTests: [...apiSet].sort() };
}

function runCommand(cmd: string[]): { code: number; output: string } {
	const proc = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
	const stdout = decoder.decode(proc.stdout);
	const stderr = decoder.decode(proc.stderr);
	return { code: proc.exitCode, output: `${stdout}${stderr}`.trim() };
}

function runLintStep(lintTargets: string[], scoped: boolean): StepResult {
	const start = performance.now();
	if (scoped && lintTargets.length === 0) {
		return { name: "lint:ratchet", ok: true, durationMs: 0, summary: "no lintable code files in slice" };
	}
	const args = scoped ? ["bun", "run", "scripts/lint-ratchet.ts", ...lintTargets] : ["bun", "run", "scripts/lint-ratchet.ts"];
	const res = runCommand(args);
	return {
		name: "lint:ratchet",
		ok: res.code === 0,
		durationMs: performance.now() - start,
		summary: res.code === 0 ? "0 new warnings/errors" : "lint ratchet failed",
		details: res.code === 0 ? undefined : res.output,
	};
}

const FILE_DIAGNOSTIC_RE = /^([^(:]+)\(\d+,\d+\):\s+error\s+TS\d+/u;

function filterSliceDiagnostics(lines: string[], slicePrefixes: string[]): string[] {
	const relevant: string[] = [];
	let keepContinuation = false;
	for (const line of lines) {
		const fileMatch = FILE_DIAGNOSTIC_RE.exec(line);
		if (fileMatch) {
			const diagPath = fileMatch[1]!.replace(/\\/gu, "/");
			keepContinuation = slicePrefixes.some((prefix) => diagPath.startsWith(prefix));
			if (keepContinuation) relevant.push(line);
		} else if (/^\s+/u.test(line)) {
			if (keepContinuation) relevant.push(line);
		} else {
			keepContinuation = true;
			relevant.push(line);
		}
	}
	return relevant;
}

export function runTypecheckStep(slicePrefixes: string[], scoped: boolean): StepResult {
	const start = performance.now();
	const res = runCommand(["bunx", "tsc", "--noEmit", "--pretty", "false"]);
	const durationMs = performance.now() - start;
	if (res.code === 0) {
		return { name: "typecheck", ok: true, durationMs, summary: "0 TypeScript errors" };
	}
	const lines = res.output.split(/\r?\n/u).filter(Boolean);
	if (!scoped) {
		return {
			name: "typecheck",
			ok: false,
			durationMs,
			summary: `${lines.length} TypeScript diagnostic line(s)`,
			details: res.output,
		};
	}
	const matching = filterSliceDiagnostics(lines, slicePrefixes);
	return {
		name: "typecheck",
		ok: false,
		durationMs,
		summary: `TypeScript exited ${res.code}: ${matching.length} diagnostic line(s) in slice (${lines.length} workspace-wide)`,
		details: matching.length > 0 ? matching.join("\n") : res.output,
	};
}

function selectSliceGuardrails(targetFiles: string[], scoped: boolean): GuardrailCheckName[] | undefined {
	if (!scoped) return undefined;
	return [...selectGuardrailChecksForPaths(targetFiles)];
}

function runGuardrailsStep(targetFiles: string[], scoped: boolean): StepResult {
	const start = performance.now();
	const only = selectSliceGuardrails(targetFiles, scoped);
	const findings = runGuardrails({ only, includeBoundaries: !scoped });
	const durationMs = performance.now() - start;
	if (findings.length === 0) {
		return {
			name: "guardrails",
			ok: true,
			durationMs,
			summary: only ? `passed (${only.join(",")})` : "passed (hygiene,contracts,docker-closure,migrations,boundaries)",
		};
	}
	const details = findings
		.map((f, idx) => `  ${idx + 1}. [${f.check}] ${f.message}\n     -> Fix: ${f.fix}`)
		.join("\n");
	return {
		name: "guardrails",
		ok: false,
		durationMs,
		summary: `${findings.length} guardrail violation(s)`,
		details,
	};
}

function runTestsStep(targetFiles: string[]): StepResult {
	const start = performance.now();
	const { bunTests, apiTests } = discoverRelatedTests(targetFiles);
	if (bunTests.length === 0 && apiTests.length === 0) {
		return { name: "tests", ok: true, durationMs: 0, summary: "no co-located .bun.test.{ts,tsx} files matched" };
	}
	const outputs: string[] = [];
	let ok = true;
	if (bunTests.length > 0) {
		const res = runCommand(["bun", "run", "scripts/run-bun-tests.ts", ...bunTests]);
		if (res.code !== 0) {
			ok = false;
			outputs.push(res.output);
		}
	}
	if (apiTests.length > 0) {
		const res = runCommand(["bun", "run", "scripts/run-api-tests.ts", ...apiTests]);
		if (res.code !== 0) {
			ok = false;
			outputs.push(res.output);
		}
	}
	const total = bunTests.length + apiTests.length;
	return {
		name: "tests",
		ok,
		durationMs: performance.now() - start,
		summary: ok ? `${total} test file(s) passed` : `test failure across ${total} matched test file(s)`,
		details: ok ? undefined : outputs.join("\n\n"),
	};
}

async function main() {
	const rawArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
	const skipTests = process.argv.includes("--no-tests");
	const scoped = rawArgs.length > 0;
	const normalizedPrefixes = rawArgs.map((p) => relative(ROOT, resolve(ROOT, p)).replace(/\\/gu, "/"));
	const targetFiles = scoped ? expandInputPaths(rawArgs) : await discoverWorkspaceChangedFiles();
	const lintTargets = targetFiles.filter((p) => CODE_EXT_RE.test(p));

	console.log(
		scoped
			? `Verifying slice (${rawArgs.join(", ")}) — ${targetFiles.length} file(s)...`
			: `Verifying full workspace changes — ${targetFiles.length} touched file(s)...`,
	);

	const steps: StepResult[] = [
		runLintStep(lintTargets, scoped),
		runTypecheckStep(normalizedPrefixes, scoped),
		runGuardrailsStep(targetFiles, scoped),
		...(skipTests ? [] : [runTestsStep(targetFiles)]),
	];

	console.log("\n=== Verification Summary ===");
	for (const step of steps) {
		const badge = step.ok ? "PASS" : "FAIL";
		console.log(`  [${badge}] ${step.name.padEnd(14)} (${(step.durationMs / 1000).toFixed(2)}s) — ${step.summary}`);
	}

	const failed = steps.filter((s) => !s.ok);
	if (failed.length === 0) {
		console.log("\nALL CHECKS PASSED.");
		process.exit(0);
	}

	console.error(`\nVERIFICATION FAILED (${failed.length}/${steps.length} step(s) failed):`);
	for (const step of failed) {
		if (step.details) {
			console.error(`\n--- ${step.name} ---\n${step.details}`);
		}
	}
	process.exit(1);
}

if (import.meta.main) {
	await main();
}

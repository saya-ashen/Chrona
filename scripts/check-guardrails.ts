#!/usr/bin/env bun


import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { contractSchemasDirectory, generateContractSchemas, serializeContractSchema } from "./generate-contract-schemas";

const ROOT = resolve(import.meta.dirname, "..");
const decoder = new TextDecoder();
const MAX_STAGED_BLOB_BYTES = 1024 * 1024;
const BOUNDARY_WARNING_BUDGET = 52;

export type GuardrailCheckName = "hygiene" | "contracts" | "docker-closure" | "migrations" | "boundaries";

export interface GuardrailFinding {
	check: GuardrailCheckName;
	message: string;
	fix: string;
}

function gitPaths(root: string, args: string[]): string[] {
	const proc = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0) return [];
	return decoder.decode(proc.stdout).split("\0").filter(Boolean);
}

const FORBIDDEN_PATH_RE = /\.(?:db|db-wal|db-shm|db-journal|sqlite|sqlite3|tar\.gz|tgz)$/iu;
const FORBIDDEN_PLANS_CODE_RE = /^plans\/.+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u;
const FORBIDDEN_PLANS_META_RE = /^plans\/.+\/(?:chrona-material\.json|package\.json|bun\.lock|node_modules\/)/u;

export function evaluatePathHygiene(paths: string[], sizeOf: (relPath: string) => number | null): GuardrailFinding[] {
	const findings: GuardrailFinding[] = [];
	for (const path of paths) {
		if (FORBIDDEN_PATH_RE.test(path)) {
			findings.push({
				check: "hygiene",
				message: `Runtime database or archive artifact must not be committed: ${path}`,
				fix: `Unstage/remove '${path}' or move temporary artifacts outside tracked directories.`,
			});
			continue;
		}
		if (FORBIDDEN_PLANS_CODE_RE.test(path) || FORBIDDEN_PLANS_META_RE.test(path)) {
			findings.push({
				check: "hygiene",
				message: `Source snapshot or package tree under plans/ pollutes typecheck and search: ${path}`,
				fix: `Store only compact markdown/json evidence under plans/, not copied source trees.`,
			});
			continue;
		}
		if (path === "bun.lock") continue;
		const size = sizeOf(path);
		if (size !== null && size > MAX_STAGED_BLOB_BYTES) {
			findings.push({
				check: "hygiene",
				message: `Oversized file (${(size / 1024).toFixed(0)} KiB > 1024 KiB) staged for commit: ${path}`,
				fix: `Keep binary/large dumps out of Git; store test fixtures as minimal synthetic data.`,
			});
		}
	}
	return findings;
}

function stagedBlobSize(root: string, relPath: string): number | null {
	const proc = Bun.spawnSync(["git", "cat-file", "-s", `:${relPath}`], { cwd: root, stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0) return null;
	const parsed = Number.parseInt(decoder.decode(proc.stdout).trim(), 10);
	return Number.isFinite(parsed) ? parsed : null;
}

export function checkHygiene(root = ROOT): GuardrailFinding[] {
	const staged = gitPaths(root, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]);
	const stagedAdded = new Set(gitPaths(root, ["diff", "--cached", "--name-only", "-z", "--diff-filter=A"]));
	const candidates = staged.filter((p) => !p.startsWith("plans/") || stagedAdded.has(p));
	return evaluatePathHygiene(candidates, (relPath) => stagedBlobSize(root, relPath));
}

export function checkContracts(schemasDir = contractSchemasDirectory): GuardrailFinding[] {
	const findings: GuardrailFinding[] = [];
	for (const [name, schema] of Object.entries(generateContractSchemas())) {
		const target = resolve(schemasDir, name);
		const actual = existsSync(target) ? readFileSync(target, "utf8") : "";
		if (actual !== serializeContractSchema(schema)) {
			const hint = "Run 'bun scripts/generate-contract-schemas.ts' and sync 'scripts/generate-contract-schemas.bun.test.ts' if namespaces changed.";
			findings.push({
				check: "contracts",
				message: `Committed contract schema '${name}' is out of sync with TypeScript declarations.`,
				fix: hint,
			});
		}
	}
	return findings;
}

function translateGlobToken(normalized: string, index: number): { chunk: string; advance: number } {
	if (normalized.slice(index, index + 2) === "**") {
		const hasSlash = normalized[index + 2] === "/";
		return { chunk: hasSlash ? "(?:.+/)?" : ".*", advance: hasSlash ? 3 : 2 };
	}
	const ch = normalized[index]!;
	if (ch === "*") return { chunk: "[^/]*", advance: 1 };
	if (ch === "?") return { chunk: "[^/]", advance: 1 };
	if (ch === "[") {
		const close = normalized.indexOf("]", index + 1);
		if (close > index + 1) return { chunk: normalized.slice(index, close + 1), advance: close - index + 1 };
	}
	return { chunk: "+^${}()|[]\\.".includes(ch) ? `\\${ch}` : ch, advance: 1 };
}

function globToRegExp(pattern: string): RegExp {
	const normalized = pattern.replace(/^\/+/u, "").replace(/\/+$/u, "");
	let regex = "^";
	for (let i = 0; i < normalized.length;) {
		const { chunk, advance } = translateGlobToken(normalized, i);
		regex += chunk;
		i += advance;
	}
	return new RegExp(`${regex}(?:$|/.*$)`, "u");
}

export function isIgnoredByDockerignore(relPath: string, dockerignoreContent: string): boolean {
	const cleanPath = relPath.replace(/\\/gu, "/").replace(/^\.\//u, "");
	let ignored = false;
	for (const rawLine of dockerignoreContent.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const negated = line.startsWith("!");
		const body = negated ? line.slice(1).trim() : line;
		if (body && globToRegExp(body).test(cleanPath)) ignored = !negated;
	}
	return ignored;
}

function resolveLocalImport(fromFile: string, specifier: string): string | null {
	if (!specifier.startsWith(".")) return null;
	const base = resolve(dirname(fromFile), specifier);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, resolve(base, "index.ts")]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

function collectLocalImportClosure(root: string, entrypoints: string[]): string[] {
	const visited = new Set<string>();
	const queue = entrypoints.map((entry) => resolve(root, entry)).filter(existsSync);
	const importRe = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/gu;
	while (queue.length > 0) {
		const current = queue.pop()!;
		if (visited.has(current)) continue;
		visited.add(current);
		for (const match of readFileSync(current, "utf8").matchAll(importRe)) {
			const spec = match[1] || match[2];
			const resolved = spec ? resolveLocalImport(current, spec) : null;
			if (resolved && !visited.has(resolved)) queue.push(resolved);
		}
	}
	return [...visited].map((abs) => relative(root, abs).replace(/\\/gu, "/")).sort();
}

export function checkDockerClosure(root = ROOT): GuardrailFinding[] {
	const dockerignorePath = resolve(root, ".dockerignore");
	if (!existsSync(dockerignorePath)) return [];
	const dockerignore = readFileSync(dockerignorePath, "utf8");
	const closure = collectLocalImportClosure(root, [
		"scripts/build/build-binaries.ts",
		"packages/process/scripts/build-helper.ts",
	]);
	return closure
		.filter((relPath) => isIgnoredByDockerignore(relPath, dockerignore))
		.map((relPath) => ({
			check: "docker-closure" as const,
			message: `Build dependency '${relPath}' is imported by Docker build scripts but excluded by .dockerignore.`,
			fix: `Add '!${relPath}' after the matching exclusion rule in .dockerignore.`,
		}));
}

const SCALAR_PRISMA_TYPES = new Set(["String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json", "Bytes"]);

function parseModelColumns(body: string): string[] {
	const columns: string[] = [];
	for (const rawLine of body.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
		const fieldMatch = /^(\w+)\s+(\w+)(\[\])?\??(.*)$/u.exec(line);
		if (!fieldMatch || fieldMatch[3] || !SCALAR_PRISMA_TYPES.has(fieldMatch[2]!)) continue;
		const colMap = /@map\("([^"]+)"\)/u.exec(fieldMatch[4]!);
		columns.push(colMap?.[1] ?? fieldMatch[1]!);
	}
	return columns;
}

function parsePrismaModels(schemaText: string): Array<{ table: string; columns: string[] }> {
	return [...schemaText.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gmu)].map((match) => {
		const tableMap = /@@map\("([^"]+)"\)/u.exec(match[2]!);
		return { table: tableMap?.[1] ?? match[1]!, columns: parseModelColumns(match[2]!) };
	});
}

export function checkMigrations(root = ROOT): GuardrailFinding[] {
	const schemaPath = resolve(root, "packages/db/prisma/schema.prisma");
	const sqlPath = resolve(root, "packages/db/prisma/migrations/0001_initial/migration.sql");
	if (!existsSync(schemaPath) || !existsSync(sqlPath)) {
		return [{
			check: "migrations",
			message: `Missing required Prisma schema or initial migration (${!existsSync(schemaPath) ? "packages/db/prisma/schema.prisma" : "0001_initial/migration.sql"}).`,
			fix: `Restore packages/db/prisma/schema.prisma and packages/db/prisma/migrations/0001_initial/migration.sql.`,
		}];
	}
	const db = new Database(":memory:");
	try {
		db.exec(readFileSync(sqlPath, "utf8"));
		const findings: GuardrailFinding[] = [];
		for (const model of parsePrismaModels(readFileSync(schemaPath, "utf8"))) {
			const rows = db.query(`PRAGMA table_info(${JSON.stringify(model.table)})`).all() as Array<{ name: string }>;
			if (rows.length === 0) {
				findings.push({
					check: "migrations",
					message: `Table '${model.table}' in packages/db/prisma/schema.prisma is missing from 0001_initial/migration.sql.`,
					fix: `Regenerate migration: bunx prisma migrate diff --from-empty --to-schema packages/db/prisma/schema.prisma --script`,
				});
				continue;
			}
			const existingCols = new Set(rows.map((r) => r.name));
			for (const col of model.columns.filter((c) => !existingCols.has(c))) {
				findings.push({
					check: "migrations",
					message: `Column '${model.table}.${col}' in packages/db/prisma/schema.prisma is missing from 0001_initial/migration.sql.`,
					fix: `Sync packages/db/prisma/migrations/0001_initial/migration.sql with packages/db/prisma/schema.prisma.`,
				});
			}
		}
		return findings;
	} catch (error) {
		return [{
			check: "migrations",
			message: `Failed to execute 0001_initial/migration.sql in SQLite: ${error instanceof Error ? error.message : String(error)}`,
			fix: `Fix SQL syntax in packages/db/prisma/migrations/0001_initial/migration.sql.`,
		}];
	} finally {
		db.close();
	}
}

interface CruiseSummary {
	error?: number;
	warn?: number;
	violations?: Array<{ severity: string; rule: { name: string }; from: string; to: string }>;
}

export function checkBoundaries(root = ROOT): GuardrailFinding[] {
	const proc = Bun.spawnSync(
		[
			"bunx", "dependency-cruiser", "--output-type", "json",
			"apps", ...readdirSync(resolve(root, "packages"), { withFileTypes: true })
				.filter(entry => entry.isDirectory() && existsSync(resolve(root, "packages", entry.name, "package.json")))
				.map(entry => `packages/${entry.name}`),
		],
		{ cwd: root, stdout: "pipe", stderr: "pipe" },
	);
	const raw = decoder.decode(proc.stdout).trim();
	if (!raw) {
		if (proc.exitCode !== 0) {
			return [{
				check: "boundaries",
				message: `dependency-cruiser exited with ${proc.exitCode}: ${decoder.decode(proc.stderr).trim().slice(0, 240)}`,
				fix: `Check .dependency-cruiser.cjs and run 'bun run check:boundaries' to inspect the failure.`,
			}];
		}
		return [];
	}
	const parsed = JSON.parse(raw) as { summary?: CruiseSummary };
	const errors = parsed.summary?.error ?? 0;
	const warns = parsed.summary?.warn ?? 0;
	const findings: GuardrailFinding[] = [];
	if (errors > 0) {
		const sample = (parsed.summary?.violations ?? [])
			.filter((v) => v.severity === "error")
			.slice(0, 5)
			.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`)
			.join("; ");
		findings.push({
			check: "boundaries",
			message: `${errors} architecture boundary error(s): ${sample}`,
			fix: `Respect apps -> host/kernel -> domain -> contracts direction; run 'bun run check:boundaries' for details.`,
		});
	}
	if (warns > BOUNDARY_WARNING_BUDGET) {
		findings.push({
			check: "boundaries",
			message: `Boundary warning ratchet exceeded: ${warns} warnings > budget ${BOUNDARY_WARNING_BUDGET}.`,
			fix: `Avoid importing apps/server or deep kernel internals from package tests; use public exports.`,
		});
	}
	return findings;
}

const STAGED_CHECK_RULES: Array<{ check: GuardrailCheckName; match: (p: string) => boolean }> = [
	{
		check: "contracts",
		match: (p) =>
			p.startsWith("packages/contracts/") ||
			p.startsWith("packages/kernel/src/system/") ||
			p.includes("module-tool") ||
			p.includes("generate-contract-schemas"),
	},
	{
		check: "docker-closure",
		match: (p) =>
			p === ".dockerignore" ||
			p.startsWith("Dockerfile") ||
			p.startsWith("scripts/build/") ||
			p.startsWith("packages/process/"),
	},
	{
		check: "migrations",
		match: (p) => p.startsWith("packages/db/prisma/"),
	},
];

export function selectGuardrailChecksForPaths(paths: string[]): Set<GuardrailCheckName> {
	const checks = new Set<GuardrailCheckName>(["hygiene"]);
	for (const path of paths) {
		for (const rule of STAGED_CHECK_RULES) {
			if (rule.match(path)) checks.add(rule.check);
		}
	}
	return checks;
}

export interface RunGuardrailsOptions {
	stagedOnly?: boolean;
	only?: GuardrailCheckName[];
	includeBoundaries?: boolean;
	root?: string;
}

export function runGuardrails(options: RunGuardrailsOptions = {}): GuardrailFinding[] {
	const root = options.root ?? ROOT;
	const defaultChecks: GuardrailCheckName[] = [
		"hygiene", "contracts", "docker-closure", "migrations",
		...(options.includeBoundaries ? ["boundaries" as const] : []),
	];
	const active = options.only
		? new Set(options.only)
		: options.stagedOnly
			? selectGuardrailChecksForPaths(gitPaths(root, ["diff", "--cached", "--name-only", "-z"]))
			: new Set(defaultChecks);
	const findings: GuardrailFinding[] = [];
	if (active.has("hygiene")) findings.push(...checkHygiene(root));
	if (active.has("contracts")) findings.push(...checkContracts(resolve(root, "packages/contracts/schemas")));
	if (active.has("docker-closure")) findings.push(...checkDockerClosure(root));
	if (active.has("migrations")) findings.push(...checkMigrations(root));
	if (active.has("boundaries")) findings.push(...checkBoundaries(root));
	return findings;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const stagedOnly = args.includes("--staged");
	const includeBoundaries = args.includes("--with-boundaries");
	const onlyArg = args.find((a) => a.startsWith("--only="));
	const only = onlyArg ? (onlyArg.slice("--only=".length).split(",") as GuardrailCheckName[]) : undefined;
	const findings = runGuardrails({ stagedOnly, only, includeBoundaries });
	if (findings.length === 0) {
		console.log(`Guardrails passed (${stagedOnly ? "staged" : only ? only.join(",") : "full"}).`);
		process.exit(0);
	}
	console.error(`Guardrails failed with ${findings.length} finding(s):\n`);
	for (const [idx, item] of findings.entries()) {
		console.error(`  ${idx + 1}. [${item.check}] ${item.message}`);
		console.error(`     -> Fix: ${item.fix}`);
	}
	process.exit(1);
}

import { existsSync } from "node:fs";
import { runTestFiles } from "./run-bun-tests";

const glob = new Bun.Glob("*.bun.test.{ts,tsx}");
// Every server test, not only the HTTP map walk: the server holds the authenticated listen proxy.
const dirs = ["apps/server/src/__tests__/api", "apps/server/src/__tests__", "apps/server/src", "apps/server/src/config", "apps/server/src/middleware"];

async function discoverTestFiles(): Promise<string[]> {
	const requestedFiles = process.argv.slice(2).filter(arg => arg !== "--list").map(path => path.replace(/^\.\//u, ""));
	if (requestedFiles.length > 0) {
		for (const candidate of requestedFiles) {
			if (!candidate.startsWith("apps/server/") || !existsSync(candidate)) {
				throw new Error(`Invalid API test file: ${candidate}`);
			}
		}
		return requestedFiles;
	}
	const files: string[] = [];
	for (const dir of dirs) {
		const entries = (await Array.fromAsync(glob.scan(dir))).sort((a, b) => a.localeCompare(b));
		for (const file of entries) files.push(`${dir}/${file}`);
	}
	return files;
}

if (import.meta.main) {
	const files = await discoverTestFiles();
	if (process.argv.includes("--list")) console.log(JSON.stringify(files));
	else process.exit(await runTestFiles(files, "API"));
}

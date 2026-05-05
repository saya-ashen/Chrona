export {};

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const webSrcRoot = path.join(projectRoot, "apps/web/src");
const componentsRoot = path.join(webSrcRoot, "components");
const sourceExtensions = new Set([".ts", ".tsx"]);

function walk(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, into);
      continue;
    }

    if (sourceExtensions.has(path.extname(entry.name))) {
      into.push(fullPath);
    }
  }

  return into;
}

function isTestFile(filePath: string) {
  return /\.(test|spec)\.(ts|tsx)$/.test(filePath);
}

function isPageLikeFile(filePath: string) {
  const base = path.basename(filePath).toLowerCase();
  return base.includes("page") && !isTestFile(filePath);
}

function isSimpleReExport(text: string) {
  const trimmed = text.trim();
  return /^export\s+(\*|\{[\s\S]*\})\s+from\s+["'][^"']+["'];?$/.test(trimmed);
}

function resolveImport(fromFile: string, specifier: string) {
  const basePath = specifier.startsWith("@/")
    ? path.join(webSrcRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null;

  if (!basePath) {
    return null;
  }

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const allSourceFiles = walk(webSrcRoot);
const pageLikeFiles = walk(componentsRoot).filter(isPageLikeFile);
const runtimeImportersByFile = new Map<string, Set<string>>();

for (const sourceFile of allSourceFiles) {
  if (isTestFile(sourceFile)) {
    continue;
  }

  const text = readFileSync(sourceFile, "utf8");
  const importPattern = /import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(text))) {
    const resolved = resolveImport(sourceFile, match[1]);
    if (!resolved) {
      continue;
    }

    const importers = runtimeImportersByFile.get(resolved) ?? new Set<string>();
    importers.add(sourceFile);
    runtimeImportersByFile.set(resolved, importers);
  }
}

const orphanedPages: Array<{ file: string; reason: string }> = [];

for (const pageFile of pageLikeFiles) {
  const text = readFileSync(pageFile, "utf8");
  if (isSimpleReExport(text)) {
    continue;
  }

  const importers = Array.from(runtimeImportersByFile.get(pageFile) ?? []);
  if (importers.length > 0) {
    continue;
  }

  orphanedPages.push({
    file: path.relative(projectRoot, pageFile),
    reason: "no non-test importers",
  });
}

if (orphanedPages.length === 0) {
  console.log("web page reachability pass");
  process.exit(0);
}

console.error("web page reachability failed");
for (const page of orphanedPages) {
  console.error(`- ${page.file}: ${page.reason}`);
}
console.error("Move real route screens under an explicit route/screen entry, or delete dead page components.");
process.exit(1);

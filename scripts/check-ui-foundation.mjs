import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_ROOT = process.cwd();
const SOURCE_ROOT = path.join("apps", "web", "src");
const GENERATED_UI_BUTTON = path.join(
  "apps",
  "web",
  "src",
  "components",
  "ui",
  "button.tsx"
);
const GUARD_TEST_FILE = path.join(
  "apps",
  "web",
  "src",
  "test",
  "ui-foundation-guard.test.ts"
);

const FORBIDDEN_PATTERNS = [
  {
    name: "legacy status badge import",
    regex: /@\/components\/ui\/status-badge/,
  },
  {
    name: "legacy surface card import",
    regex: /@\/components\/ui\/surface-card/,
  },
  {
    name: "legacy status badge symbol",
    regex: /\bStatusBadge\b/,
  },
  {
    name: "legacy surface card symbol",
    regex: /\bSurfaceCard(?:Header|Title|Description)?\b/,
  },
  {
    name: "legacy field class helper",
    regex: /\b(?:inputClassName|textareaClassName|selectClassName)\b/,
  },
  {
    name: "consumer buttonVariants usage",
    regex: /\bbuttonVariants\b/,
    allowFile: (relativePath) => relativePath === GENERATED_UI_BUTTON,
  },
];

function parseRoot(argv) {
  const rootFlagIndex = argv.indexOf("--root");

  if (rootFlagIndex >= 0) {
    return path.resolve(argv[rootFlagIndex + 1] ?? DEFAULT_ROOT);
  }

  return DEFAULT_ROOT;
}

function shouldSkipDirectory(name) {
  return [".git", ".worktrees", "node_modules", "dist", "build", "coverage"].includes(name);
}

function collectSourceFiles(directory, files = []) {
  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry.name)) {
        collectSourceFiles(path.join(directory, entry.name), files);
      }
      continue;
    }

    if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

export function findUiFoundationViolations(root = DEFAULT_ROOT) {
  const sourceRoot = path.join(root, SOURCE_ROOT);
  const files = collectSourceFiles(sourceRoot);
  const violations = [];

  for (const file of files) {
    const relativePath = path.relative(root, file).split(path.sep).join("/");

    if (relativePath === GUARD_TEST_FILE) {
      continue;
    }

    const content = fs.readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.allowFile?.(relativePath)) {
          continue;
        }

        if (pattern.regex.test(line)) {
          violations.push({
            file: relativePath,
            line: index + 1,
            rule: pattern.name,
            text: line.trim(),
          });
        }
      }
    });
  }

  return violations;
}

export function formatViolations(violations) {
  if (violations.length === 0) {
    return "UI foundation guard passed: no duplicate primitive consumers found.";
  }

  return [
    `UI foundation guard failed: ${violations.length} duplicate primitive reference(s) found.`,
    ...violations.map(
      (violation) =>
        `${violation.file}:${violation.line} ${violation.rule}: ${violation.text}`
    ),
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = findUiFoundationViolations(parseRoot(process.argv.slice(2)));
  process.stdout.write(`${formatViolations(violations)}\n`);
  process.exit(violations.length === 0 ? 0 : 1);
}

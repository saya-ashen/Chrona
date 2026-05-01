export {};

const include = new Bun.Glob("**/*.bun.test.ts");
const ignoredSegments = new Set(["node_modules", ".direnv", ".git", ".worktrees", "dist", "build", "coverage"]);

function shouldInclude(path: string) {
  return !path.split("/").some((segment) => ignoredSegments.has(segment));
}

const files = (await Array.fromAsync(include.scan(".")))
  .filter(shouldInclude)
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  process.exit(0);
}

let exitCode = 0;

for (const file of files) {
  const proc = Bun.spawn(["bun", "test", file], {
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    exitCode = code;
  }
}

process.exit(exitCode);

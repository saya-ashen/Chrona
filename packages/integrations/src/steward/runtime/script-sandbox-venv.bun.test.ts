import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScriptSandbox } from "./script-sandbox";

const python = Bun.which("python3") ?? Bun.which("python");
(process.platform === "linux" && python ? test : test.skip)("Python virtual environment keeps its interpreter symlink and private site packages", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-venv-regression-"));
  try {
    const codeDir = join(root, "code"), dataDir = join(root, "data");
    await mkdir(codeDir); await mkdir(dataDir);
    const created = spawnSync(python!, ["-m", "venv", "--without-pip", join(codeDir, ".venv")], { encoding: "utf8", timeout: 10_000 });
    expect(created.status).toBe(0);
    const interpreter = join(codeDir, ".venv", "bin", "python");
    const location = spawnSync(interpreter, ["-c", "import sysconfig; print(sysconfig.get_path('purelib'))"], { encoding: "utf8", timeout: 3000 });
    expect(location.status).toBe(0);
    await writeFile(join(location.stdout.trim(), "chrona_private_venv_fixture.py"), "VALUE = 42\n");
    await writeFile(join(codeDir, "main.py"), "import sys\nimport chrona_private_venv_fixture\nprint(chrona_private_venv_fixture.VALUE)\nprint(sys.prefix)\n");
    const result = await createScriptSandbox().runModule({ codeDir, dataDir, entry: "main.py", input: {} });
    expect(result.status).toBe("succeeded");
    expect(result.output).toBe(`42\n${join(codeDir, ".venv")}\n`);
  } finally { await rm(root, { recursive: true, force: true }); }
});
